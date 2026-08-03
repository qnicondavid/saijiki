// The file format, which is a promise rather than an implementation detail.
//
// "The data must stay readable and editable in any text editor, with no
// software at all, in twenty years." Two things follow from that, and they are
// the reason this module is longer than a JSON.parse would be:
//
// 1. It must read what a *person* wrote, not only what it wrote itself. A hand
//    edit arrives with trailing whitespace, keys in the wrong order, a comment,
//    a block list instead of an inline one, CRLF, a UTF-8 BOM courtesy of
//    Notepad. None of that is corruption and none of it may be treated as such.
//
// 2. It must write back what it did not understand. A field added by a later
//    version has to survive being read and rewritten by this one, or upgrading
//    becomes a one-way door. So parsing keeps the original line for every key
//    alongside the value this build decoded from it, and writing re-emits the
//    original line unless the value actually changed. Comments, quoting,
//    ordering and spacing all survive for free, and a rewrite touches only the
//    lines whose meaning moved.
//
// The YAML subset here is deliberate and small: `key: value`, inline lists, and
// block lists. One rule differs from real YAML on purpose — a value that
// *begins* with `#` is a colour, not a comment, because `paper: #c94f3d`
// unquoted is exactly what a person would type and silently reading it as an
// empty value would be data loss. A `#` after a value is still a comment.

import { CATEGORIES, CATEGORY_PAPERS, type Category } from "./papers";
import { seasonOf, toDayNumber, type BucketId, type DateLike } from "./seasons";

/** The version this build writes. A file that says more than this is newer than us. */
export const CURRENT_SCHEMA = 1;

/**
 * The day a kigo was last known to be true. This is what the fading curve
 * counts seasons from.
 *
 * A kigo that has never been touched fades from the day it was written rather
 * than from nothing: writing it down was the first statement that it was true,
 * and an entry made this morning has not been neglected. The alternative — an
 * untouched kigo starting at the floor — would make the recording ceremony
 * produce a bleached butterfly, which is precisely backwards.
 */
export function lastKnownTrue(kigo: Pick<Kigo, "touched" | "created">): string {
  return kigo.touched[kigo.touched.length - 1] ?? kigo.created;
}

/**
 * Has this kigo's butterfly come out yet?
 *
 * CLAUDE.md's Emergence: a recorded entry is a folded square until the widget
 * is next opened on a *later day*, and then it unfolds. So the answer is simply
 * whether today is past the day it was written — derived, never stored.
 *
 * That it is derived is the whole design. A stored `emerged: true` would be a
 * new frontmatter field, a schema bump, a migration, and a flag that can rot:
 * hand-edit the file, copy the store to another machine, scrub the clock back,
 * and the flag and the dates disagree with no way to tell which is right. A
 * function of two dates cannot disagree with itself. It also means the time
 * scrubber moves emergence for free — `]` is a day, and a day is exactly what
 * this is waiting for.
 *
 * Strictly later, not "at least a day": the promise is *the next day you open
 * it*, and something recorded at one minute past midnight has still only been
 * recorded today.
 */
export function hasEmerged(kigo: { created: DateLike }, today: DateLike): boolean {
  return toDayNumber(today) > toDayNumber(kigo.created);
}

export interface Verse {
  text: string;
  /** The day the verse was added. Null if the file did not say. */
  date: string | null;
}

export interface Kigo {
  schema: number;
  /** Immutable forever: the whole creature is derived from it. */
  id: string;
  created: string;
  season: BucketId;
  category: Category;
  paper: string;
  touched: string[];
  text: string;
  verses: Verse[];
  /**
   * How the file was laid out when it was read. Not part of the entry — it is
   * formatting memory, so that writing back changes only what changed.
   */
  raw?: RawFile;
}

type FieldValue = string | string[];

export interface RawFile {
  eol: string;
  bom: boolean;
  front: FrontLine[];
  body: BodyBlock[];
}

type FrontLine =
  | { kind: "field"; key: string; raw: string[]; decoded: FieldValue }
  | { kind: "other"; raw: string[] };

type BodyBlock =
  | { kind: "heading"; raw: string; decoded: string }
  | { kind: "verse"; raw: string; decoded: Verse }
  | { kind: "other"; raw: string };

const KNOWN_KEYS = ["schema", "id", "created", "season", "category", "paper", "touched"] as const;
const KNOWN = new Set<string>(KNOWN_KEYS);

const FIELD = /^ {0,3}([A-Za-z_][A-Za-z0-9_-]*)\s*:(.*)$/;
const BLOCK_ITEM = /^\s*-\s+(.*)$/;
const HEADING = /^#(?!#)[ \t]*(.*)$/;
const VERSE = /^-[ \t]+(.*)$/;
const VERSE_DATE = /^(.*?)[ \t]*\((\d{4}-\d{2}-\d{2})\)$/;

// --- reading ---------------------------------------------------------------

export function parseKigo(source: string): Kigo {
  const bom = source.startsWith("\uFEFF");
  const text = bom ? source.slice(1) : source;
  // Notepad writes CRLF. Whatever the file uses, it keeps.
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);

  if (lines[0]?.trim() !== "---") throw new Error("no frontmatter: the file must open with ---");
  const close = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (close < 0) throw new Error("unterminated frontmatter: no closing ---");

  const front = parseFront(lines.slice(1, close));
  const body = parseBody(lines.slice(close + 1));
  const field = (key: string) => front.find((l) => l.kind === "field" && l.key === key);

  const id = String(scalarOf(field("id")) ?? "").trim();
  if (!id) throw new Error("no id: a kigo without one has no creature");
  const created = String(scalarOf(field("created")) ?? "").trim();
  if (!created) throw new Error(`no created date on ${id}`);

  const categoryLine = field("category");
  // An unknown category is a later version's, not a mistake. It renders as the
  // seasonless stock, and the line itself is left exactly as written.
  const rawCategory = String(scalarOf(categoryLine) ?? "muki").trim();
  const category: Category = (CATEGORIES as readonly string[]).includes(rawCategory)
    ? (rawCategory as Category)
    : "muki";
  if (categoryLine?.kind === "field") categoryLine.decoded = category;

  const schemaText = String(scalarOf(field("schema")) ?? CURRENT_SCHEMA).trim();
  const schema = Number.parseInt(schemaText, 10);
  if (!Number.isInteger(schema) || schema < 1) throw new Error(`bad schema on ${id}: ${schemaText}`);

  // season and paper are derivable, so an absent or unreadable one is filled in
  // rather than fatal.
  const seasonText = String(scalarOf(field("season")) ?? "").trim();
  const derived = seasonOf(created).bucketId;
  const season: BucketId = isBucketId(seasonText) ? seasonText : derived;

  const paperText = String(scalarOf(field("paper")) ?? "").trim();
  const paper = paperText || CATEGORY_PAPERS[category];

  const touchedLine = field("touched");
  const touched = touchedLine?.kind === "field" ? asList(touchedLine.decoded) : [];

  const heading = body.find((b) => b.kind === "heading");
  const text_ = heading?.kind === "heading" ? heading.decoded : "";
  const verses = body.flatMap((b) => (b.kind === "verse" ? [b.decoded] : []));

  return {
    schema,
    id,
    created,
    season,
    category,
    paper,
    touched,
    text: text_,
    verses,
    raw: { eol, bom, front, body },
  };
}

function parseFront(lines: string[]): FrontLine[] {
  const out: FrontLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = FIELD.exec(lines[i]);
    if (!m) {
      out.push({ kind: "other", raw: [lines[i]] });
      continue;
    }
    const raw = [lines[i]];
    const rest = m[2];
    let decoded: FieldValue;
    if (rest.trim() === "") {
      // A block list — what a person writes when the inline one gets long.
      const items: string[] = [];
      while (i + 1 < lines.length && BLOCK_ITEM.test(lines[i + 1]) && !FIELD.test(lines[i + 1])) {
        i++;
        raw.push(lines[i]);
        items.push(decodeScalar(BLOCK_ITEM.exec(lines[i])![1]));
      }
      decoded = items.length > 0 ? items : "";
    } else if (rest.trim().startsWith("[")) {
      decoded = decodeInlineList(rest);
    } else {
      decoded = decodeScalar(rest);
    }
    out.push({ kind: "field", key: m[1], raw, decoded });
  }
  return out;
}

function parseBody(lines: string[]): BodyBlock[] {
  const out: BodyBlock[] = [];
  let seenHeading = false;
  for (const line of lines) {
    const h = seenHeading ? null : HEADING.exec(line);
    if (h) {
      seenHeading = true;
      out.push({ kind: "heading", raw: line, decoded: h[1].trim() });
      continue;
    }
    const v = VERSE.exec(line);
    if (v) {
      out.push({ kind: "verse", raw: line, decoded: decodeVerse(v[1]) });
      continue;
    }
    out.push({ kind: "other", raw: line });
  }
  return out;
}

function decodeVerse(rest: string): Verse {
  const m = VERSE_DATE.exec(rest.trim());
  return m ? { text: m[1].trim(), date: m[2] } : { text: rest.trim(), date: null };
}

function decodeScalar(rest: string): string {
  const t = rest.trim();
  if (t.startsWith('"')) {
    const m = /^"((?:[^"\\]|\\.)*)"/.exec(t);
    if (m) return m[1].replace(/\\(["\\])/g, "$1");
  }
  if (t.startsWith("'")) {
    const m = /^'((?:[^']|'')*)'/.exec(t);
    if (m) return m[1].replace(/''/g, "'");
  }
  if (t.startsWith("#")) return t; // a colour, not a comment
  const comment = t.search(/\s#/);
  return (comment >= 0 ? t.slice(0, comment) : t).trim();
}

function decodeInlineList(rest: string): string[] {
  const t = rest.trim();
  const end = t.lastIndexOf("]");
  const inner = t.slice(1, end >= 0 ? end : undefined);
  return inner
    .split(",")
    .map((part) => decodeScalar(part))
    .filter((part) => part !== "");
}

function scalarOf(line: FrontLine | undefined): string | undefined {
  if (!line || line.kind !== "field") return undefined;
  return Array.isArray(line.decoded) ? line.decoded[0] : line.decoded;
}

function asList(value: FieldValue): string[] {
  if (Array.isArray(value)) return [...value];
  return value.trim() === "" ? [] : [value.trim()];
}

function isBucketId(value: string): value is BucketId {
  return value === "new-year" || /^(spring|summer|autumn|winter)\/(early|middle|late)$/.test(value);
}

// --- writing ---------------------------------------------------------------

export function serialiseKigo(kigo: Kigo): string {
  const raw = kigo.raw;
  const eol = raw?.eol ?? "\n";
  const lines: string[] = ["---"];
  const written = new Set<string>();

  for (const line of raw?.front ?? []) {
    if (line.kind === "other" || !KNOWN.has(line.key)) {
      lines.push(...line.raw); // a comment, a blank, or a key from a later version
      continue;
    }
    written.add(line.key);
    const now = fieldValue(kigo, line.key);
    lines.push(...(sameValue(now, line.decoded) ? line.raw : [canonicalField(line.key, now)]));
  }

  for (const key of KNOWN_KEYS) {
    if (written.has(key)) continue;
    const now = fieldValue(kigo, key);
    // A key the file left out stays out while its absence still says the same
    // thing — an omitted `touched` on an untouched kigo is not a missing line.
    if (raw && sameValue(now, impliedValue(kigo, key))) continue;
    lines.push(canonicalField(key, now));
  }

  lines.push("---", ...serialiseBody(kigo, raw));
  return (raw?.bom ? "\uFEFF" : "") + lines.join(eol);
}

function serialiseBody(kigo: Kigo, raw: RawFile | undefined): string[] {
  if (!raw) {
    const out = [`# ${kigo.text}`];
    if (kigo.verses.length > 0) out.push("", ...kigo.verses.map(formatVerse));
    out.push("");
    return out;
  }

  const out: string[] = [];
  let next = 0;
  let afterLastVerse = -1;
  let hadHeading = false;
  for (const block of raw.body) {
    switch (block.kind) {
      case "heading":
        hadHeading = true;
        out.push(block.decoded === kigo.text ? block.raw : `# ${kigo.text}`);
        break;
      case "verse": {
        const verse = kigo.verses[next++];
        if (!verse) break; // a verse was removed: so is its line
        out.push(sameVerse(verse, block.decoded) ? block.raw : formatVerse(verse));
        afterLastVerse = out.length;
        break;
      }
      case "other":
        out.push(block.raw);
        break;
    }
  }
  if (!hadHeading && kigo.text) out.unshift(`# ${kigo.text}`);

  const fresh = kigo.verses.slice(next).map(formatVerse);
  if (fresh.length > 0) {
    if (afterLastVerse >= 0) {
      out.splice(afterLastVerse, 0, ...fresh);
    } else {
      // No verses yet: open a new stanza after the text, keeping whatever
      // trailing blank lines the file ended with.
      let end = out.length;
      while (end > 0 && out[end - 1].trim() === "") end--;
      out.splice(end, 0, "", ...fresh);
    }
  }
  return out;
}

function formatVerse(verse: Verse): string {
  return `- ${verse.text}${verse.date ? ` (${verse.date})` : ""}`;
}

function sameVerse(a: Verse, b: Verse): boolean {
  return a.text === b.text && a.date === b.date;
}

function fieldValue(kigo: Kigo, key: string): FieldValue {
  switch (key) {
    case "schema":
      return String(kigo.schema);
    case "id":
      return kigo.id;
    case "created":
      return kigo.created;
    case "season":
      return kigo.season;
    case "category":
      return kigo.category;
    case "paper":
      return kigo.paper;
    case "touched":
      return kigo.touched;
    default:
      throw new Error(`not a known field: ${key}`);
  }
}

/** What parsing would have produced had the key been absent altogether. */
function impliedValue(kigo: Kigo, key: string): FieldValue {
  switch (key) {
    case "schema":
      return String(CURRENT_SCHEMA);
    case "season":
      return seasonOf(kigo.created).bucketId;
    case "paper":
      return CATEGORY_PAPERS[kigo.category];
    case "touched":
      return [];
    default:
      return "\u0000"; // id and created are required; nothing implies them
  }
}

function sameValue(a: FieldValue, b: FieldValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const x = asList(a);
    const y = asList(b);
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }
  return a === b;
}

function canonicalField(key: string, value: FieldValue): string {
  if (Array.isArray(value)) return `${key}: [${value.join(", ")}]`;
  return `${key}: ${needsQuotes(value) ? quote(value) : value}`;
}

function needsQuotes(value: string): boolean {
  return (
    value === "" ||
    value !== value.trim() ||
    /^[#\-?&*!|>%@`'"[{]/.test(value) ||
    /:\s/.test(value) ||
    /\s#/.test(value)
  );
}

function quote(value: string): string {
  return `"${value.replace(/(["\\])/g, "\\$1")}"`;
}
