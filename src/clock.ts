// The app's notion of "today", and the only place in it that asks the machine
// what day it is.
//
// Everything else — the fading curve, the anniversary check, whichever bucket a
// new kigo is filed under — takes a date as an argument, and gets it from here.
// That is not tidiness. Year-three state has to be inspectable on day one, and
// a single module that calls `new Date()` on the quiet is enough to make the
// whole UI un-scrubbable: the swarm would fade against a scrubbed date while
// something else compared against the real one, and the two would disagree in a
// way that looks like a bug in the curve. clock.test.ts greps the source for
// exactly that.
//
// Two pieces of state, and they mean different things:
//
//   · `anchor` is `--today=YYYY-MM-DD` from the command line. It pins the clock
//     flat: the machine's own date stops being consulted at all, so a screenshot
//     taken today and one taken next March are the same picture.
//   · `offsetDays` is the scrub, a signed number of days on top of whatever the
//     base is. It is days rather than seasons because a season is not a fixed
//     length, and a scrubber that drifted by a day per leap year would put the
//     boundaries in the wrong place after three of them.
//
// Nothing here fires on a rAF. The clock changes when someone scrubs it, or
// once at midnight, and both are rare enough to be events.

import {
  addDays,
  daysBetween,
  stepSeason,
  toCivil,
  toISODate,
  seasonOf,
  type CivilDate,
  type DateLike,
} from "./seasons";

/**
 * What day it is according to the machine.
 *
 * The one `new Date()` in the app. Read through its *local* getters, because a
 * kigo is filed under a civil day and not an instant — see the CivilDate note
 * in seasons.ts.
 */
export function systemToday(): CivilDate {
  return toCivil(new Date());
}

let anchor: CivilDate | null = null;
let offsetDays = 0;
let cached: string | null = null;

const listeners = new Set<() => void>();

function compute(): string {
  const base = anchor ?? systemToday();
  return toISODate(offsetDays === 0 ? base : addDays(base, offsetDays));
}

/** Today, as `YYYY-MM-DD`. Cheap: recomputed only when it can have changed. */
export function today(): string {
  if (cached === null) cached = compute();
  return cached;
}

export function todayCivil(): CivilDate {
  return toCivil(today());
}

/**
 * Recompute, and tell everyone if the answer moved.
 *
 * Called after a scrub and on a slow ticker, so that a widget left running
 * overnight is looking at the right day in the morning. There is nothing to
 * notice when it fires — nothing in this app changes day to day — but the
 * alternative is a swarm that fades one day late, forever.
 */
export function refreshClock(): void {
  const next = compute();
  if (next === cached) return;
  cached = next;
  for (const listener of listeners) listener();
}

export function onClockChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Poll for the midnight rollover. Returns a stop function. */
export function startClockTicker(everyMs = 60_000): () => void {
  const id = setInterval(refreshClock, everyMs);
  return () => clearInterval(id);
}

// --- the scrubber ----------------------------------------------------------

/** Pin the clock to a date, or hand it back to the machine with `null`. */
export function setAnchor(date: DateLike | null): void {
  anchor = date === null ? null : toCivil(date);
  refreshClock();
}

export function scrubDays(days: number): void {
  offsetDays += Math.trunc(days);
  refreshClock();
}

/**
 * Move to the day a season opened, `steps` seasons away.
 *
 * This is the one that matters. Fading is seasonal, so a day of scrubbing shows
 * nothing at all and a season of it drains a visible amount of colour out of the
 * swarm — and landing exactly on the boundary means the step that was taken is
 * the step the curve sees.
 */
export function scrubSeasons(steps: number): void {
  const from = today();
  offsetDays += daysBetween(from, stepSeason(from, steps));
  refreshClock();
}

export function resetScrub(): void {
  offsetDays = 0;
  refreshClock();
}

export function scrubOffsetDays(): number {
  return offsetDays;
}

export function isScrubbed(): boolean {
  return offsetDays !== 0 || anchor !== null;
}

/**
 * One line for the F9 overlay. It says the date and the bucket, and says
 * plainly when what is on screen is not the real day — a widget quietly two
 * years into the future is a very expensive thing to mistake for a bug.
 */
export function clockLabel(): string {
  const iso = today();
  return `today: ${iso} · ${seasonOf(iso).bucketId}${isScrubbed() ? " · SCRUBBED" : ""}`;
}

/**
 * Where the scrub has got to, or null when the clock is the machine's own. A
 * second line rather than a longer first one: the overlay sits in a 420px
 * window and a line that runs off the edge is a line nobody reads.
 */
export function scrubLabel(): string | null {
  if (!isScrubbed()) return null;
  const parts: string[] = [];
  if (anchor) parts.push(`anchored ${toISODate(anchor)}`);
  if (offsetDays !== 0) parts.push(`${offsetDays > 0 ? "+" : ""}${offsetDays}d`);
  return `  ${parts.join(" · ")} · \\ to come back`;
}

/** Tests only: put the module back the way it was found. */
export function resetClock(): void {
  anchor = null;
  offsetDays = 0;
  cached = null;
}
