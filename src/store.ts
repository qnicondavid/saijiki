// The kigo store: create, read, update, touch.
//
// It talks to a KigoIO and nothing else, so the same code runs against the
// real store, the dev store, and a Map in a test — and so no test can find its
// way onto the user's disk by accident.
//
// Two rules shape everything here.
//
// The id is immutable. Filenames are not: they carry the date and a slug of
// the text so that a directory listing reads like an almanac, which means
// fixing a typo renames the file. The id never moves with it — a butterfly's
// whole appearance is derived from the id, so an id that changed when the text
// did would silently replace the creature. Lookup is therefore by id and never
// by path, and the rename is write-new-then-remove-old so a crash between the
// two leaves a duplicate rather than a hole.
//
// index.json is a cache and nothing else. Every read path here works with it
// deleted, stale, or truncated: `scan` never consults it, `read` uses it only
// as a hint and verifies the id it lands on, and a failed index write never
// fails the entry write that prompted it. It exists so step 5 can render
// without reading three hundred files, not because anything depends on it.

import { CURRENT_SCHEMA, parseKigo, serialiseKigo, type Kigo } from "./kigo-format";
import { assertStorePath, type KigoIO } from "./kigo-io";
import { CATEGORY_PAPERS, type Category } from "./papers";
import { seasonOf, toISODate, type BucketId, type DateLike } from "./seasons";

export const KIGO_DIR = "kigo";
export const INDEX_PATH = "index.json";

export interface Draft {
  text: string;
  category: Category;
  created: DateLike;
  /** Defaults to the category's stock paper. */
  paper?: string;
}

/** The editable fields. Everything else — id, created, season — is not. */
export interface Patch {
  text?: string;
  category?: Category;
  paper?: string;
}

export interface StoredKigo {
  kigo: Kigo;
  path: string;
}

export interface ScanProblem {
  path: string;
  message: string;
}

export interface ScanResult {
  entries: StoredKigo[];
  /**
   * Files that would not parse. They are reported rather than thrown, because
   * one hand-edited typo must not take the whole diary down with it.
   */
  problems: ScanProblem[];
}

export interface IndexEntry {
  id: string;
  path: string;
  created: string;
  season: BucketId;
  category: Category;
  paper: string;
  text: string;
  touched: string[];
  verses: number;
}

export interface KigoIndex {
  schema: number;
  entries: IndexEntry[];
}

export type Migration = (kigo: Kigo) => Kigo;

/**
 * There is only version 1, so this is empty — but the hook is here and wired
 * up, because the first migration is written under time pressure and that is
 * the worst moment to be designing the mechanism as well.
 */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

/**
 * Bring a file up to the current schema. A file from the *future* is returned
 * untouched and keeps its own version number: an older build must be able to
 * read and write a newer file without quietly downgrading it.
 */
export function applyMigrations(
  kigo: Kigo,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
  current: number = CURRENT_SCHEMA,
): Kigo {
  let out = kigo;
  while (out.schema < current) {
    const step = migrations[out.schema];
    if (!step) throw new Error(`no migration from schema ${out.schema} (${out.id})`);
    const before = out.schema;
    out = step(out);
    if (out.schema <= before) throw new Error(`migration from schema ${before} did not advance it`);
  }
  return out;
}

export interface StoreOptions {
  /** Injected so tests can force a collision. */
  newId?: () => string;
  migrations?: Readonly<Record<number, Migration>>;
}

export interface KigoStore {
  scan(): Promise<ScanResult>;
  all(): Promise<Kigo[]>;
  read(id: string): Promise<Kigo | null>;
  create(draft: Draft): Promise<Kigo>;
  update(id: string, patch: Patch): Promise<Kigo>;
  touch(id: string, date: DateLike, verse?: string): Promise<Kigo>;
  /** The cache, rebuilt first if it is missing or no longer matches the files. */
  index(): Promise<KigoIndex>;
  rebuildIndex(): Promise<KigoIndex>;
}

export function createStore(io: KigoIO, options: StoreOptions = {}): KigoStore {
  const newId = options.newId ?? mintId;
  const migrations = options.migrations ?? MIGRATIONS;

  async function kigoPaths(): Promise<string[]> {
    const all = await io.list();
    return all.filter((p) => p.startsWith(`${KIGO_DIR}/`) && p.endsWith(".md")).sort();
  }

  async function scan(): Promise<ScanResult> {
    const entries: StoredKigo[] = [];
    const problems: ScanProblem[] = [];
    for (const path of await kigoPaths()) {
      const source = await io.read(path);
      if (source === null) continue; // vanished between listing and reading
      try {
        entries.push({ kigo: applyMigrations(parseKigo(source), migrations), path });
      } catch (error) {
        problems.push({ path, message: error instanceof Error ? error.message : String(error) });
      }
    }
    entries.sort(byCreatedThenId);
    return { entries, problems };
  }

  async function locate(id: string): Promise<StoredKigo | null> {
    // The cache says where it was last seen. Trust it only far enough to read
    // one file, and only if that file still says it is the same kigo.
    const hinted = (await readIndex(io))?.entries.find((e) => e.id === id)?.path;
    if (hinted) {
      const source = await io.read(hinted).catch(() => null);
      if (source !== null) {
        try {
          const kigo = applyMigrations(parseKigo(source), migrations);
          if (kigo.id === id) return { kigo, path: hinted };
        } catch {
          // fall through to the scan
        }
      }
    }
    return (await scan()).entries.find((e) => e.kigo.id === id) ?? null;
  }

  async function write(kigo: Kigo, path: string, previousPath?: string): Promise<void> {
    assertStorePath(path);
    await io.writeAtomic(path, serialiseKigo(kigo));
    if (previousPath && previousPath !== path) await io.remove(previousPath);
    await refreshIndex();
  }

  async function refreshIndex(): Promise<void> {
    // Disposable by definition: if the cache cannot be written, the entry is
    // already safely on disk and the next read rebuilds it.
    try {
      await rebuildIndex();
    } catch {
      /* ignored on purpose */
    }
  }

  async function rebuildIndex(): Promise<KigoIndex> {
    const { entries } = await scan();
    const index: KigoIndex = {
      schema: CURRENT_SCHEMA,
      entries: entries.map(({ kigo, path }) => ({
        id: kigo.id,
        path,
        created: kigo.created,
        season: kigo.season,
        category: kigo.category,
        paper: kigo.paper,
        text: kigo.text,
        touched: [...kigo.touched],
        verses: kigo.verses.length,
      })),
    };
    await io.writeAtomic(INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`);
    return index;
  }

  return {
    scan,
    async all() {
      return (await scan()).entries.map((e) => e.kigo);
    },

    async read(id) {
      return (await locate(id))?.kigo ?? null;
    },

    async create(draft) {
      const text = draft.text.trim();
      if (!text) throw new Error("a kigo needs its one line");
      const created = toISODate(draft.created);
      const { entries } = await scan();
      const taken = new Map(entries.map((e) => [e.path, e.kigo.id]));
      const ids = new Set(entries.map((e) => e.kigo.id));

      const category = draft.category;
      const kigo: Kigo = {
        schema: CURRENT_SCHEMA,
        id: uniqueId(newId, ids),
        created,
        season: seasonOf(created).bucketId,
        category,
        paper: draft.paper ?? CATEGORY_PAPERS[category],
        touched: [],
        text,
        verses: [],
      };
      const path = pathFor(kigo, taken);
      await write(kigo, path);
      return kigo;
    },

    async update(id, patch) {
      const found = await locate(id);
      if (!found) throw new Error(`no kigo with id ${id}`);
      const next: Kigo = {
        ...found.kigo,
        text: patch.text === undefined ? found.kigo.text : patch.text.trim(),
        category: patch.category ?? found.kigo.category,
        paper: patch.paper ?? found.kigo.paper,
      };
      if (!next.text) throw new Error("a kigo needs its one line");

      const { entries } = await scan();
      const taken = new Map(entries.map((e) => [e.path, e.kigo.id]));
      const path = pathFor(next, taken);
      await write(next, path, found.path);
      return next;
    },

    async touch(id, date, verse) {
      const found = await locate(id);
      if (!found) throw new Error(`no kigo with id ${id}`);
      const day = toISODate(date);
      const touched = found.kigo.touched.includes(day)
        ? [...found.kigo.touched] // touching twice in a day is one touch
        : [...found.kigo.touched, day].sort();
      const verses = [...found.kigo.verses];
      const line = verse?.trim();
      if (line) verses.push({ text: line, date: day });

      const next: Kigo = { ...found.kigo, touched, verses };
      // A touch never renames: the text has not moved.
      await write(next, found.path);
      return next;
    },

    async index() {
      const cached = await readIndex(io);
      if (cached && sameFiles(cached, await kigoPaths())) return cached;
      return rebuildIndex();
    },

    rebuildIndex,
  };
}

// --- paths and ids ---------------------------------------------------------

/**
 * `kigo/2026-02-11-kitchen-phone.md`. The date sorts the directory into an
 * almanac and the slug makes it findable in Notepad; neither is load-bearing,
 * because the id inside the file is what identifies it.
 */
export function pathFor(kigo: Kigo, taken: ReadonlyMap<string, string> = new Map()): string {
  const stem = slug(kigo.text) || bareId(kigo.id);
  let path = `${KIGO_DIR}/${kigo.created}-${stem}.md`;
  const owner = taken.get(path);
  if (owner !== undefined && owner !== kigo.id) {
    path = `${KIGO_DIR}/${kigo.created}-${stem}-${bareId(kigo.id)}.md`;
  }
  assertStorePath(path);
  return path;
}

/**
 * Letters and numbers in any script, everything else a hyphen. Japanese text
 * keeps its kanji; nothing that could upset a filesystem survives, so the
 * result is safe on all three platforms without a separate escaping pass.
 */
export function slug(text: string): string {
  const cleaned = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return [...cleaned].slice(0, 48).join("").replace(/-+$/u, "");
}

function bareId(id: string): string {
  return id.replace(/^k_/, "");
}

/** Six hex digits behind a `k_`, from the platform CSPRNG. */
export function mintId(): string {
  const source = globalThis.crypto;
  if (!source?.getRandomValues) throw new Error("no crypto.getRandomValues: cannot mint an id");
  const bytes = source.getRandomValues(new Uint8Array(3));
  return `k_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function uniqueId(mint: () => string, taken: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 64; attempt++) {
    const id = mint();
    if (!taken.has(id)) return id;
  }
  throw new Error("could not mint an unused id");
}

// --- the cache -------------------------------------------------------------

async function readIndex(io: KigoIO): Promise<KigoIndex | null> {
  const source = await io.read(INDEX_PATH).catch(() => null);
  if (source === null) return null;
  try {
    const parsed: unknown = JSON.parse(source);
    if (!isIndex(parsed) || parsed.schema !== CURRENT_SCHEMA) return null;
    return parsed;
  } catch {
    return null; // truncated, half-written, or edited by hand: rebuild it
  }
}

function isIndex(value: unknown): value is KigoIndex {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { schema?: unknown; entries?: unknown };
  if (typeof candidate.schema !== "number" || !Array.isArray(candidate.entries)) return false;
  return candidate.entries.every(
    (entry: unknown) =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as IndexEntry).id === "string" &&
      typeof (entry as IndexEntry).path === "string",
  );
}

/**
 * Cheap staleness check: the same set of files, so nothing has been added or
 * removed behind the app's back. An edit to a file that is already listed is
 * not caught here and does not need to be — nothing reads entry contents from
 * the cache except as a lookup hint, and `scan` is the source of truth.
 */
function sameFiles(index: KigoIndex, paths: readonly string[]): boolean {
  const cached = index.entries.map((e) => e.path).sort();
  return cached.length === paths.length && cached.every((p, i) => p === paths[i]);
}

function byCreatedThenId(a: StoredKigo, b: StoredKigo): number {
  if (a.kigo.created !== b.kigo.created) return a.kigo.created < b.kigo.created ? -1 : 1;
  return a.kigo.id < b.kigo.id ? -1 : a.kigo.id > b.kigo.id ? 1 : 0;
}
