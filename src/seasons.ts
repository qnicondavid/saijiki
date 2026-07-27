// The saijiki calendar.
//
// Traditional haiku seasons, not Western ones. The trap in this module is the
// *year*: the season year runs Feb 4 -> Feb 3, so winter straddles the calendar
// boundary and a January date belongs to the season year that began the
// previous February. Every date function here goes through `seasonYearOf`
// rather than reading `.year` directly, so that rule lives in exactly one place.
//
// There is no clock in this file. Every function takes its date as an argument,
// because year-three state has to be inspectable on day one — the time-scrubber
// in CLAUDE.md's working agreements only works if nothing calls Date.now() on
// the quiet.
//
// The division boundaries are the 二十四節気 solar terms, which is where
// CLAUDE.md's "roughly 30 days each" comes from: 立春 Feb 4, 啓蟄 Mar 6,
// 清明 Apr 5, 立夏 May 6, and so on round the year. Fixed calendar dates, not
// a running count of thirty days from the season's start — an almanac's
// divisions are dates, and a day-count would drift by one every leap year, so
// the same date would land in different buckets in different years.
//
// Bucket arithmetic: four seasons at three divisions each is twelve, plus New
// Year is thirteen. CLAUDE.md used to say "fifteen plus New Year makes
// sixteen", which the date table it sits next to cannot produce; the sentence
// has been corrected rather than the table.

export type Season = "spring" | "summer" | "autumn" | "winter" | "new-year";
export type Division = "early" | "middle" | "late";

export type BucketId =
  | "spring/early"
  | "spring/middle"
  | "spring/late"
  | "summer/early"
  | "summer/middle"
  | "summer/late"
  | "autumn/early"
  | "autumn/middle"
  | "autumn/late"
  | "winter/early"
  | "winter/middle"
  | "winter/late"
  | "new-year";

export interface SeasonPlace {
  season: Season;
  /** New Year has no division — it is one, carved out of winter. */
  division: Division | null;
  bucketId: BucketId;
}

// --- dates -----------------------------------------------------------------
//
// A kigo is filed under a *day*, not an instant: `created: 2026-02-11` in the
// frontmatter has no time and no zone, and it means that day wherever the user
// happens to be. So the calendar works in civil dates and never in timestamps.
// `new Date("2026-02-11")` parses as UTC midnight, which is Feb 10 in every
// timezone west of Greenwich — that is the bug this type exists to make
// impossible, so ISO strings are parsed by hand and a Date is read through its
// *local* getters.

export interface CivilDate {
  readonly year: number;
  readonly month: number; // 1-12
  readonly day: number; // 1-31
}

export type DateLike = CivilDate | Date | string;

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  return month === 2 && isLeapYear(year) ? 29 : MONTH_LENGTHS[month - 1];
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function toCivil(date: DateLike): CivilDate {
  if (typeof date === "string") {
    const m = ISO_DATE.exec(date);
    if (!m) throw new Error(`not a YYYY-MM-DD date: ${JSON.stringify(date)}`);
    return checked({ year: +m[1], month: +m[2], day: +m[3] }, date);
  }
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime())) throw new Error("invalid Date");
    // Local getters on purpose: "today" is the user's day, not UTC's.
    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
  }
  return checked(date, date);
}

function checked(c: CivilDate, source: unknown): CivilDate {
  const ok =
    Number.isInteger(c.year) &&
    Number.isInteger(c.month) &&
    Number.isInteger(c.day) &&
    c.year >= 1 &&
    c.month >= 1 &&
    c.month <= 12 &&
    c.day >= 1 &&
    c.day <= daysInMonth(c.year, c.month);
  if (!ok) throw new Error(`not a real date: ${JSON.stringify(source)}`);
  return { year: c.year, month: c.month, day: c.day };
}

export function toISODate(date: DateLike): string {
  const c = toCivil(date);
  const p = (n: number, w: number) => String(n).padStart(w, "0");
  return `${p(c.year, 4)}-${p(c.month, 2)}-${p(c.day, 2)}`;
}

// --- day arithmetic --------------------------------------------------------
//
// Howard Hinnant's days_from_civil / civil_from_days, which are exact integer
// arithmetic over the proleptic Gregorian calendar and, crucially, involve no
// Date and no timestamp. Going via `Date.UTC(y, m, d) + n * 86400000` would work
// too right up until someone passes a local Date in and a timezone west of
// Greenwich turns the answer into yesterday — the trap `CivilDate` exists to
// close, so it is not going to be reopened here for the sake of one subtraction.

/** Days since 1970-01-01. Negative before it. */
export function toDayNumber(date: DateLike): number {
  const { year, month, day } = toCivil(date);
  // March-based year: February's leap day becomes the last day, which is what
  // makes the rest of this table-free.
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400; // [0, 399]
  const mp = month + (month > 2 ? -3 : 9); // [0, 11], March first
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1; // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function fromDayNumber(days: number): CivilDate {
  const z = Math.trunc(days) + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097; // [0, 146096]
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  return { year: y + (month <= 2 ? 1 : 0), month, day };
}

export function addDays(date: DateLike, days: number): CivilDate {
  return fromDayNumber(toDayNumber(date) + Math.trunc(days));
}

/** Signed: how many days you would have to add to `from` to reach `to`. */
export function daysBetween(from: DateLike, to: DateLike): number {
  return toDayNumber(to) - toDayNumber(from);
}

// --- the year --------------------------------------------------------------

/** Feb 4, as month * 100 + day. The origin of the season year. */
const SPRING_START = 204;

/**
 * Sortable position within the season year, Feb 4 first and Feb 3 last.
 * January and Feb 1-3 close the year that opened last February, so they are
 * pushed past December rather than sorting before March.
 */
function rankWithinSeasonYear(c: CivilDate): number {
  const md = c.month * 100 + c.day;
  return md >= SPRING_START ? md : md + 1300;
}

/**
 * The February the current season year opened in. A January date belongs to
 * the *previous* calendar year's season year — this is the whole trap.
 */
export function seasonYearOf(date: DateLike): number {
  const c = toCivil(date);
  return c.month * 100 + c.day >= SPRING_START ? c.year : c.year - 1;
}

interface Boundary {
  rank: number;
  season: Season;
  division: Division | null;
  bucket: BucketId;
}

function boundary(
  month: number,
  day: number,
  season: Season,
  division: Division | null,
  bucket: BucketId,
): Boundary {
  return { rank: rankWithinSeasonYear({ year: 2001, month, day }), season, division, bucket };
}

// The thirteen buckets, each as the day it opens, in season-year order. A date
// belongs to the last bucket that has opened on or before it, so this table is
// the entire calendar — there is no second place where a season boundary is
// written down.
const BOUNDARIES: readonly Boundary[] = [
  boundary(2, 4, "spring", "early", "spring/early"), // 立春
  boundary(3, 6, "spring", "middle", "spring/middle"), // 啓蟄
  boundary(4, 5, "spring", "late", "spring/late"), // 清明
  boundary(5, 6, "summer", "early", "summer/early"), // 立夏
  boundary(6, 6, "summer", "middle", "summer/middle"), // 芒種
  boundary(7, 7, "summer", "late", "summer/late"), // 小暑
  boundary(8, 8, "autumn", "early", "autumn/early"), // 立秋
  boundary(9, 8, "autumn", "middle", "autumn/middle"), // 白露
  boundary(10, 8, "autumn", "late", "autumn/late"), // 寒露
  boundary(11, 7, "winter", "early", "winter/early"), // 立冬
  boundary(12, 7, "winter", "middle", "winter/middle"), // 大雪
  // New Year is carved out of winter and is not part of it. It takes Jan 1-7,
  // which swallows 小寒 (Jan 6) whole, so late winter resumes on Jan 8 and runs
  // to Feb 3 — the only division whose start date is the carve-out's edge
  // rather than a solar term.
  boundary(1, 1, "new-year", null, "new-year"),
  boundary(1, 8, "winter", "late", "winter/late"),
];

const ORDERED_BUCKETS: readonly BucketId[] = Object.freeze(BOUNDARIES.map((b) => b.bucket));

export function seasonOf(date: DateLike): SeasonPlace {
  const r = rankWithinSeasonYear(toCivil(date));
  for (let i = BOUNDARIES.length - 1; i >= 0; i--) {
    const b = BOUNDARIES[i];
    if (r >= b.rank) return { season: b.season, division: b.division, bucketId: b.bucket };
  }
  // Unreachable: Feb 4 is both the first boundary and the lowest rank there is.
  throw new Error(`no bucket for ${toISODate(date)}`);
}

/** The thirteen buckets in chronological order within a season year. */
export function orderedBuckets(): readonly BucketId[] {
  return ORDERED_BUCKETS;
}

// --- bucket arithmetic, for depth ------------------------------------------
//
// The fading curve counts seasons; depth counts *buckets*, because CLAUDE.md
// makes the bucket the depth-clustering unit — kigo filed under the same
// division of the same season share a plane. Thirteen buckets to a season year,
// and the table above is already in chronological order, so a bucket has an
// ordinal for the same reason a season does.
//
// New Year is a real bucket here, unlike in the fading curve, where folding it
// into winter is what stops a week of January costing 15% of a butterfly's
// colour. Depth has no such problem: a kigo begun on Jan 3 and one begun on
// Jan 10 genuinely were begun in different divisions of the almanac, and one
// plane's worth of recession over a week is a millimetre.

const BUCKET_INDEX: ReadonlyMap<BucketId, number> = new Map(
  ORDERED_BUCKETS.map((bucket, i) => [bucket, i] as const),
);

function bucketOrdinal(date: DateLike): number {
  const c = toCivil(date);
  return seasonYearOf(c) * ORDERED_BUCKETS.length + BUCKET_INDEX.get(seasonOf(c).bucketId)!;
}

/**
 * How many bucket boundaries lie between two dates. Signed, like
 * `seasonsSince`: a `to` earlier than `from` counts backwards, which the depth
 * model reads as "at the glass" rather than as an error.
 *
 * The ordinals are contiguous across the New Year carve-out — new-year is the
 * twelfth bucket of a season year and late winter the thirteenth, both falling
 * in the *following* calendar year — so this is a subtraction and not a search.
 */
export function bucketsSince(from: DateLike, to: DateLike): number {
  return bucketOrdinal(to) - bucketOrdinal(from);
}

// --- fading ----------------------------------------------------------------

// New Year folds into winter here, and only here. It is its own bucket for
// filing and for depth, but counting it as a fifth season would mean a kigo
// touched on Jan 3 had aged a whole season by Jan 8 — a week of real time
// costing 15% of its colour. Fading is seasonal precisely so that nothing
// changes day to day; there are four seasons in a year for this purpose.
const SEASON_ORDINAL: Record<Season, number> = {
  spring: 0,
  summer: 1,
  autumn: 2,
  winter: 3,
  "new-year": 3,
};

function seasonOrdinal(date: DateLike): number {
  const c = toCivil(date);
  return seasonYearOf(c) * 4 + SEASON_ORDINAL[seasonOf(c).season];
}

// The four season starts, in season-year order. New Year is deliberately not
// one of them: it is its own bucket for filing and for depth, but fading counts
// it as winter, and a scrubber that stopped on Jan 1 would move the display by
// a week and the colour by nothing.
const SEASON_STARTS: readonly (readonly [number, number])[] = [
  [2, 4], // 立春
  [5, 6], // 立夏
  [8, 8], // 立秋
  [11, 7], // 立冬
];

/**
 * The day a season opened, from its ordinal. Spring, summer and autumn open in
 * the season year's own calendar year, and so does winter — it is winter's
 * *tail* that crosses into the next one.
 */
function seasonStartOf(ordinal: number): CivilDate {
  const seasonYear = Math.floor(ordinal / 4);
  const [month, day] = SEASON_STARTS[ordinal - seasonYear * 4];
  return { year: seasonYear, month, day };
}

/**
 * Move `steps` seasons and land on the day that season opened.
 *
 * Landing on the boundary rather than keeping the day-of-season is the point:
 * this is what the time-scrubber steps by, and the thing being demonstrated is
 * the fading curve, which only ever changes at a boundary. `seasonsSince(from,
 * stepSeason(from, n))` is exactly `n`, which is the property the scrubber
 * needs and the reason not to approximate a season as ninety-one days.
 */
export function stepSeason(date: DateLike, steps: number): CivilDate {
  return seasonStartOf(seasonOrdinal(date) + Math.trunc(steps));
}

/**
 * How many season boundaries lie between two dates. Signed: a `to` earlier
 * than `from` counts backwards, which `saturationFor` treats as no fading at
 * all rather than as an error.
 */
export function seasonsSince(from: DateLike, to: DateLike): number {
  return seasonOrdinal(to) - seasonOrdinal(from);
}

// CLAUDE.md's table, as fractions of full colour. The floor is the point:
// neglect bleaches paper, it does not destroy it, so nothing here ever reaches
// zero however long it is left.
const FADE_CURVE: readonly number[] = [1, 0.85, 0.65, 0.5];
export const SATURATION_FLOOR = 0.4;

/** Colour remaining, 1 = full. Never below the floor, never above 1. */
export function saturationFor(seasons: number): number {
  if (!Number.isFinite(seasons)) throw new Error(`not a season count: ${seasons}`);
  const n = Math.max(0, Math.trunc(seasons));
  return n < FADE_CURVE.length ? FADE_CURVE[n] : SATURATION_FLOOR;
}
