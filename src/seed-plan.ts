// The synthetic saijiki: a hundred and fifty fake kigo, planned as plain data.
//
// This half is pure — no filesystem, no clock, no randomness that is not seeded
// — so the distribution can be asserted in a unit test rather than eyeballed
// after the fact, and so the same seed always produces the same creatures. That
// second property matters more than it looks: a butterfly's entire appearance
// derives from its id, so a seeder that minted fresh ids on every run would
// give a different swarm every time and make "did that change?" unanswerable.
// scripts/seed.ts is the half that touches a disk.
//
// --- what the shape is for -------------------------------------------------
//
// The numbers here are not decoration. Each one exists to make something
// visible that is otherwise invisible on day one:
//
//   · Clustering. A life is lumpy: some seasons you start three things and some
//     you start nothing. A flat 150/39 would put four in every bucket and make
//     step 8's depth planes look correct when they are not, because every plane
//     would be equally busy. So buckets are drawn lumpy and several are empty.
//     None gets twelve — a bucket that crowded is a bug in the distribution,
//     not a life.
//   · All eight papers. Seven categories plus muki, dealt from a shuffled deck
//     so none is missing and the palette can be judged whole.
//   · The fading curve. Without a spread of touch dates every butterfly is at
//     full colour and the curve is untested by looking. So roughly a third are
//     touched inside the current season, a third are one or two seasons stale,
//     and a third have not been touched for over a year and sit on the floor.
//   · Verses, zero to six, because a wing carrying six lines and a wing carrying
//     none are different typographic problems and both have to be looked at.
//
// --- and what the text is for ----------------------------------------------
//
// Obviously synthetic, deliberately. This data ends up in screenshots and in
// GIFs, and the one thing worse than a demo that looks fake is a demo that
// looks like a stranger's diary. So every line says "sample kigo" in it and the
// tail describes paper rather than a person.

import { CURRENT_SCHEMA, type Kigo, type Verse } from "./kigo-format";
import { mulberry32 } from "./noise";
import { CATEGORIES, CATEGORY_PAPERS, type Category } from "./papers";
import {
  addDays,
  daysBetween,
  seasonOf,
  seasonYearOf,
  seasonsSince,
  stepSeason,
  toISODate,
  type BucketId,
  type DateLike,
} from "./seasons";

export interface SeedOptions {
  /** The day the synthetic saijiki is planned against. */
  today: DateLike;
  count?: number;
  /** How far back the oldest entry may be, in seasons. Twelve is three years. */
  seasons?: number;
  seed?: number;
}

export interface BucketPlan {
  bucket: BucketId;
  seasonYear: number;
  count: number;
}

export interface SeedSummary {
  today: string;
  span: { from: string; to: string };
  count: number;
  buckets: {
    total: number;
    empty: number;
    busiest: number;
    /** how many buckets hold n entries, indexed by n */
    histogram: number[];
  };
  categories: Record<Category, number>;
  /** how many kigo carry n verses, indexed by n */
  verses: number[];
  /** how many kigo are n seasons stale, indexed by n and capped at 4 */
  fade: number[];
  touch: { fresh: number; stale: number; untouched: number };
}

export interface SeedPlan {
  kigo: Kigo[];
  buckets: BucketPlan[];
  summary: SeedSummary;
}

/** Comfortably under twelve. A bucket busier than this is a bug, not a life. */
const BUSIEST_BUCKET = 9;
const EMPTY_BUCKET_CHANCE = 0.28;
const MOST_TOUCHES = 6;

export const DEFAULT_SEED = 0x5a1_31c1;

export function planSeed(options: SeedOptions): SeedPlan {
  const today = toISODate(options.today);
  const count = options.count ?? 150;
  const seasons = options.seasons ?? 12;
  const rng = mulberry32(options.seed ?? DEFAULT_SEED);

  const from = toISODate(stepSeason(today, -seasons));
  const days = everyDayBetween(from, today);
  const buckets = groupIntoBuckets(days);
  // New Year is seven days long and the buckets at either end of the window are
  // partial, so a bucket cannot always hold as many entries as the shape would
  // like. Two kigo begun on the same day is not something this seeder pretends
  // to; the cap is per bucket and the share-out works within it.
  const counts = shareOut(
    buckets.map((b) => Math.min(BUSIEST_BUCKET, b.days.length)),
    count,
    rng,
  );

  // Deal the papers rather than drawing them: eight categories over a hundred
  // and fifty entries, dealt from a shuffled deck, means none of the eight is
  // missing by bad luck and the palette can be judged whole.
  const deck = shuffle(dealDeck(count), rng);

  const kigo: Kigo[] = [];
  const ids = new Set<string>();
  const plans: BucketPlan[] = [];

  buckets.forEach((group, i) => {
    plans.push({ bucket: group.bucket, seasonYear: group.seasonYear, count: counts[i] });
    for (const created of pickDays(group.days, counts[i], rng)) {
      kigo.push(makeKigo(created, today, deck[kigo.length], mintId(rng, ids), kigo.length, rng));
    }
  });

  kigo.sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : 0));

  return { kigo, buckets: plans, summary: summarise(kigo, plans, today, from) };
}

// --- the calendar shape ----------------------------------------------------

function everyDayBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = 0, n = daysBetween(from, to); d <= n; d++) out.push(toISODate(addDays(from, d)));
  return out;
}

interface DayGroup {
  bucket: BucketId;
  seasonYear: number;
  days: string[];
}

/**
 * Every day filed under its (season year, bucket). This is the depth-clustering
 * unit from CLAUDE.md, so it is also the unit the entries are clustered in —
 * step 8 puts a bucket on a plane, and a plan that clustered by month would put
 * the lumps in the wrong place.
 */
function groupIntoBuckets(days: string[]): DayGroup[] {
  const byKey = new Map<string, DayGroup>();
  for (const day of days) {
    const bucket = seasonOf(day).bucketId;
    const seasonYear = seasonYearOf(day);
    const key = `${seasonYear}|${bucket}`;
    const found = byKey.get(key);
    if (found) found.days.push(day);
    else byKey.set(key, { bucket, seasonYear, days: [day] });
  }
  return [...byKey.values()];
}

/**
 * How many entries each bucket gets: lumpy, capped, and summing to exactly
 * `total`.
 *
 * The draw is deliberately uneven and the fix-up afterwards only nudges, so the
 * lumps survive being made to add up. The invariants at the end are assertions
 * rather than hopes because this runs once, in a script, and a silently flat
 * distribution would be discovered three steps later while looking at depth.
 */
function shareOut(caps: readonly number[], total: number, rng: () => number): number[] {
  const counts = caps.map((cap) =>
    rng() < EMPTY_BUCKET_CHANCE
      ? 0
      : Math.min(cap, 1 + Math.floor(Math.pow(rng(), 0.75) * (BUSIEST_BUCKET - 1))),
  );

  const sum = () => counts.reduce((a, b) => a + b, 0);
  const roomToGrow = () => counts.map((c, i) => (c > 0 && c < caps[i] ? i : -1)).filter((i) => i >= 0);
  const roomToShrink = () => counts.map((c, i) => (c > 0 ? i : -1)).filter((i) => i >= 0);

  // Nudge, never rescale: rescaling would flatten exactly the unevenness this
  // is here to produce.
  let guard = caps.length * BUSIEST_BUCKET * 4;
  while (sum() < total && guard-- > 0) {
    const room = roomToGrow();
    if (room.length === 0) break;
    counts[room[Math.floor(rng() * room.length)]]++;
  }
  while (sum() > total && guard-- > 0) {
    const room = roomToShrink();
    if (room.length === 0) break;
    counts[room[Math.floor(rng() * room.length)]]--;
  }

  // "Some buckets with three entries" is asked for by name, so it is arranged
  // rather than left to luck: move the bucket nearest three onto three and give
  // the difference to a neighbour.
  if (!counts.includes(3)) {
    let best = -1;
    for (let i = 0; i < counts.length; i++) {
      if (caps[i] < 3) continue;
      if (best < 0 || Math.abs(counts[i] - 3) < Math.abs(counts[best] - 3)) best = i;
    }
    if (best >= 0) {
      const debt = counts[best] - 3;
      counts[best] = 3;
      const room = debt > 0 ? roomToGrow() : roomToShrink();
      if (room.length > 0) counts[room[0]] += debt;
    }
  }

  const empty = counts.filter((c) => c === 0).length;
  const busiest = Math.max(...counts);
  if (sum() !== total) throw new Error(`the buckets add up to ${sum()}, not ${total}`);
  if (busiest > BUSIEST_BUCKET) throw new Error(`a bucket got ${busiest} entries`);
  if (empty < 3) throw new Error(`only ${empty} buckets are empty; a life has more`);
  if (!counts.includes(3)) throw new Error("no bucket has exactly three entries");
  return counts;
}

/** `n` distinct days out of a bucket's range, in order. */
function pickDays(days: string[], n: number, rng: () => number): string[] {
  if (n <= 0) return [];
  return shuffle(days.slice(), rng).slice(0, n).sort();
}

// --- one entry --------------------------------------------------------------

type TouchGroup = "fresh" | "stale" | "untouched";

function makeKigo(
  created: string,
  today: string,
  category: Category,
  id: string,
  index: number,
  rng: () => number,
): Kigo {
  const touched = touchesFor(created, today, rng);

  // A verse is written during a touch — that is what the ceremony is — so a
  // verse can only ever be dated on a day the kigo was touched, and an
  // untouched kigo has none. Zero to six across the set falls out of that.
  const verseCount = touched.length === 0 ? 0 : Math.floor(rng() * (touched.length + 1));
  const verses: Verse[] = touched
    .slice(touched.length - verseCount)
    .map((date) => ({ text: verseText(rng), date }));

  return {
    schema: CURRENT_SCHEMA,
    id,
    created,
    season: seasonOf(created).bucketId,
    category,
    paper: CATEGORY_PAPERS[category],
    touched,
    text: kigoText(index, rng),
    verses,
    // no `raw`: there is no file this came from, so serialiseKigo writes the
    // canonical layout, which is the one a person should find in Notepad
  };
}

/**
 * A touch history, in one of three groups.
 *
 * The groups are what make the fading curve visible, so they are chosen first
 * and the dates are made to fit — and each one falls back to a less-stale group
 * when the kigo is too young to reach it, because a kigo created last month
 * cannot have gone a year untouched however the dice landed.
 */
function touchesFor(created: string, today: string, rng: () => number): string[] {
  const age = seasonsSince(created, today);
  // The older a kigo, the likelier it has been left alone — and the likelier it
  // *can* have been: a third of everything cannot be a year untouched when a
  // third of everything is less than a year old. Weighting by age rather than
  // drawing a flat third and demoting the infeasible ones is what keeps the
  // group that demonstrates the floor from collapsing to a sixth.
  const neglect = Math.min(0.45, 0.12 + age * 0.045);
  let group: TouchGroup = rng() < neglect ? "untouched" : rng() < 0.5 ? "stale" : "fresh";
  if (group === "untouched" && age < 4) group = "stale";
  if (group === "stale" && age < 1) group = "fresh";
  if (group === "untouched") return [];

  // Where the *last* touch lands. Everything else is spread behind it. Clamped
  // to the kigo's own age, because a kigo one season old cannot be two stale
  // and quietly landing the touch on its creation day would file it as fresh.
  const staleBy = group === "stale" ? Math.min(age, rng() < 0.5 ? 1 : 2) : 0;
  const windowStart = latest(created, toISODate(stepSeason(today, -staleBy)));
  const windowEnd =
    staleBy === 0 ? today : toISODate(addDays(stepSeason(today, -staleBy + 1), -1));
  const last = dayBetween(windowStart, latest(windowStart, windowEnd), rng);

  const n = 1 + Math.floor(rng() * MOST_TOUCHES);
  const touches = new Set<string>([last]);
  while (touches.size < n) {
    const day = dayBetween(created, last, rng);
    if (touches.has(day)) break; // the window is too narrow for another distinct day
    touches.add(day);
  }
  return [...touches].sort();
}

function latest(a: string, b: string): string {
  return a > b ? a : b;
}

function dayBetween(from: string, to: string, rng: () => number): string {
  const span = Math.max(0, daysBetween(from, to));
  return toISODate(addDays(from, Math.floor(rng() * (span + 1))));
}

// --- ids --------------------------------------------------------------------

/**
 * The same shape store.ts mints — `k_` and six hex digits — but from the seeded
 * stream rather than the CSPRNG, so re-seeding gives back the same creatures.
 */
function mintId(rng: () => number, taken: Set<string>): string {
  for (let attempt = 0; attempt < 64; attempt++) {
    const id = `k_${Math.floor(rng() * 0x1000000).toString(16).padStart(6, "0")}`;
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
  throw new Error("could not mint an unused id");
}

// --- the words --------------------------------------------------------------
//
// Stock phrases about paper, never about a person. The number in the line is
// there so that a screenshot cannot be mistaken for real content even by
// someone who has never seen this file.

const ADJECTIVES = [
  "pale", "folded", "dotted", "narrow", "wide", "thin", "deckled", "plain",
  "creased", "torn", "even", "soft", "dry", "loose", "square", "long",
];

const NOUNS = [
  "square", "lantern", "crease", "margin", "ribbon", "sheet", "corner", "gutter",
  "panel", "notch", "eyelet", "band", "swatch", "leaf", "fold", "rule",
];

const TAILS = [
  "on the left", "near the fold", "at the second mark", "in the middle distance",
  "along the top edge", "behind the sheet", "under the rule", "toward the corner",
  "off the grain", "past the margin", "beside the crease", "on the third panel",
];

const VERSE_TAILS = [
  "still folded", "unchanged", "one more panel", "same as the last",
  "held its shape", "no notes", "cut a little wider", "left as found",
];

function pickFrom<T>(list: readonly T[], rng: () => number): T {
  return list[Math.floor(rng() * list.length)];
}

function kigoText(index: number, rng: () => number): string {
  const n = String(index + 1).padStart(3, "0");
  const adjective = pickFrom(ADJECTIVES, rng);
  const article = /^[aeiou]/.test(adjective) ? "an" : "a";
  return `sample kigo ${n} · ${article} ${adjective} ${pickFrom(NOUNS, rng)} ${pickFrom(TAILS, rng)}`;
}

function verseText(rng: () => number): string {
  return `sample verse · ${pickFrom(VERSE_TAILS, rng)}`;
}

// --- shuffling and dealing --------------------------------------------------

function dealDeck(count: number): Category[] {
  const deck: Category[] = [];
  while (deck.length < count) deck.push(...CATEGORIES);
  return deck.slice(0, Math.max(count, CATEGORIES.length));
}

/** Fisher-Yates against the seeded stream. In place, and returns the array. */
function shuffle<T>(list: T[], rng: () => number): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// --- the printout -----------------------------------------------------------

function summarise(
  kigo: readonly Kigo[],
  buckets: readonly BucketPlan[],
  today: string,
  from: string,
): SeedSummary {
  const categories = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  const verses: number[] = [];
  const fade: number[] = [0, 0, 0, 0, 0];
  const touch = { fresh: 0, stale: 0, untouched: 0 };

  for (const k of kigo) {
    categories[k.category]++;
    verses[k.verses.length] = (verses[k.verses.length] ?? 0) + 1;
    const since = k.touched[k.touched.length - 1] ?? k.created;
    const stale = Math.min(4, Math.max(0, seasonsSince(since, today)));
    fade[stale]++;
    if (k.touched.length === 0) touch.untouched++;
    else if (stale === 0) touch.fresh++;
    else touch.stale++;
  }
  for (let i = 0; i < verses.length; i++) verses[i] ??= 0;

  const histogram: number[] = [];
  for (const b of buckets) histogram[b.count] = (histogram[b.count] ?? 0) + 1;
  for (let i = 0; i < histogram.length; i++) histogram[i] ??= 0;

  return {
    today,
    span: { from, to: today },
    count: kigo.length,
    buckets: {
      total: buckets.length,
      empty: buckets.filter((b) => b.count === 0).length,
      busiest: Math.max(...buckets.map((b) => b.count)),
      histogram,
    },
    categories,
    verses,
    fade,
    touch,
  };
}

/** The summary as the lines the seeder prints. Text, so it can be tested too. */
export function summaryLines(summary: SeedSummary): string[] {
  const bar = (n: number, of: number) => "▉".repeat(Math.round((n / Math.max(1, of)) * 24));
  const lines = [
    `${summary.count} kigo, ${summary.span.from} to ${summary.span.to} (today is ${summary.today})`,
    "",
    `buckets: ${summary.buckets.total}, ${summary.buckets.empty} empty, busiest holds ${summary.buckets.busiest}`,
  ];
  summary.buckets.histogram.forEach((n, count) => {
    if (n > 0) lines.push(`  ${String(count).padStart(2)} entries  ${bar(n, summary.buckets.total)} ${n}`);
  });

  lines.push("", "papers:");
  for (const [category, n] of Object.entries(summary.categories)) {
    lines.push(`  ${category.padEnd(12)} ${bar(n, summary.count)} ${n}`);
  }

  lines.push("", "verses:");
  summary.verses.forEach((n, count) => {
    lines.push(`  ${count} verse${count === 1 ? " " : "s"}    ${bar(n, summary.count)} ${n}`);
  });

  // The one that matters: if this column is all zeros below the first row, the
  // fading curve is invisible however good it is.
  lines.push("", "seasons since last touch (0 is full colour, 4+ is the floor):");
  summary.fade.forEach((n, stale) => {
    lines.push(`  ${stale}${stale === 4 ? "+" : " "}          ${bar(n, summary.count)} ${n}`);
  });
  lines.push(
    "",
    `touched this season ${summary.touch.fresh} · one or two seasons stale ${summary.touch.stale} · never touched ${summary.touch.untouched}`,
  );
  return lines;
}
