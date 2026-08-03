// The saijiki: the collection, as the rest of the app needs it.
//
// One kigo per markdown file on disk, one entry in here per kigo, and three
// questions the picture asks of every one of them:
//
//   · has it come out yet, or is it still a folded square?
//   · how much colour is left in it?
//   · has its hole been cut in the back sheet?
//
// All three are functions of dates and nothing else — no flags, no stored
// state, nothing that can disagree with the files. That is what makes the time
// scrubber work at all: move the clock and every one of these answers moves
// with it, in both directions, for free.
//
// This module exists so those answers can be tested without a canvas, a window
// or a disk. It knows nothing about how any of it is drawn.

import { hasEmerged, lastKnownTrue, type Kigo, type Verse } from "./kigo-format";
import { WEAR_LEVELS, type Category } from "./papers";
import {
  SATURATION_FLOOR,
  saturationFor,
  seasonsSince,
  toDayNumber,
  type DateLike,
} from "./seasons";

/**
 * A kigo, as much of it as the picture needs.
 *
 * `created` and `since` are the two dates and they drive the two channels.
 * `created` is immutable and sets how far back in the box the butterfly sits;
 * `since` is the last touch — or the created date for a kigo that has never
 * been touched — and sets how much colour is left in it. A kigo that is touched
 * moves in colour and never in depth, which is the point: touching says *still
 * true*, not *begun again*.
 *
 * `touches` is the third, and it is a count rather than a date because it is
 * the one fact here that is not about *when*. See `wearOf`.
 */
export interface Entry {
  id: string;
  category: Category;
  created: string;
  since: string;
  /** How many times it has ever been picked up. See `wearOf`. */
  touches: number;
  /**
   * The one line, for the inner surface of the wings. Optional because most of
   * the app is perfectly happy without it — nothing in the air reads it, and it
   * appears only on a butterfly that has landed on the cursor and opened.
   */
  text?: string;
  /**
   * The verses gathered under it, oldest first, and only their words: the file
   * dates every one of them and none of those dates reaches the wing. How old a
   * verse is, is said by how faint its ink has gone, and a date would be a
   * number in an app that has spent its whole design avoiding them.
   *
   * Append-only, like `touched`, and for the same reason — you do not revise a
   * record of what was true.
   */
  verses?: readonly string[];
}

/**
 * As much of a file as this needs. Deliberately less than a whole `Kigo`, so
 * that the entry the recording ceremony has just written — which is four fields
 * and no touches yet — comes through the same door as one read off the disk.
 * Two doors would be two places for the `since` rule to live.
 */
export type Stored = Pick<Kigo, "id" | "category" | "created" | "text"> & {
  touched?: readonly string[];
  verses?: readonly Verse[];
};

/** What the store hands back, as the picture wants it. */
export function toEntry(kigo: Stored): Entry {
  return {
    id: kigo.id,
    category: kigo.category,
    created: kigo.created,
    since: lastKnownTrue({ created: kigo.created, touched: [...(kigo.touched ?? [])] }),
    touches: kigo.touched?.length ?? 0,
    text: kigo.text,
    // Their words and not their dates. The file keeps both; the wing is only
    // ever shown one of them.
    verses: kigo.verses?.map((verse) => verse.text) ?? [],
  };
}

export function toSaijiki(kigo: readonly Stored[]): Entry[] {
  return kigo.map(toEntry);
}

/**
 * How much colour is left in one, 1 at full and never below the floor.
 *
 * CLAUDE.md's five steps and nothing else, counted in seasons from the last day
 * it was known to be true. Five discrete levels rather than a curve, so the
 * palette — and therefore the butterfly tile cache key — takes one of a handful
 * of values however many kigo there are.
 */
export function fadeOf(entry: Pick<Entry, "since">, today: DateLike): number {
  return saturationFor(seasonsSince(entry.since, today));
}

/**
 * How many times a kigo has been picked up, before the first touch and after
 * every one thereafter. Nothing else in here counts touches, so it is written
 * once, here.
 */
const WEAR_AT: readonly number[] = [1, 3, 6];

/**
 * How worn one is: 0 for a fresh scissor cut, `WEAR_LEVELS - 1` for one that
 * has been handled a great deal.
 *
 * The second channel, and the one that does not read a clock. `fadeOf` counts
 * *seasons since* and says how much dye is left; this counts *touches ever* and
 * says how soft the edges have gone. They are two different facts about one
 * creature and they are allowed to disagree in every combination — a butterfly
 * that is far, faint and deeply worn was loved for a long time and has been let
 * be; one that is near, faint and pristine was written down and never returned
 * to. Colour alone cannot tell those apart, and CLAUDE.md asks for both:
 * untouched go crisp but pale, touched go soft but vivid.
 *
 * Monotone and it never goes back down, which is what makes it safe to read as
 * affection rather than as damage. Nothing here can take wear away — the store
 * only ever appends to `touched` — so a much-handled kigo stays much-handled
 * however long it is then left alone. The colour comes back on a touch. The
 * softness never leaves.
 *
 * Quantised, and to only four steps, because it goes into the palette key and
 * therefore into the tile cache key. See `paletteFor`.
 *
 * The thresholds are widely spaced on purpose: touching is rare — it means
 * *still true*, not *seen today* — so a first touch has to register, and the
 * top step has to be reachable within a couple of years of ordinary use without
 * being reached by everyone at once. The seeded dev store lands 35 · 46 · 53 ·
 * 16 across the four, which is the distribution these were chosen against.
 */
export function wearOf(entry: Pick<Entry, "touches">): number {
  let level = 0;
  while (level < WEAR_AT.length && entry.touches >= WEAR_AT[level]) level++;
  return Math.min(level, WEAR_LEVELS - 1);
}

/**
 * How fresh the cut in the back sheet is: 1 the season it was made, 0 once it
 * has settled.
 *
 * The same five-step curve as the fade, normalised onto its own range, and
 * counted from `created` rather than from the last touch — because a cut is
 * made once and is never made again. Touching a kigo restores its colour; it
 * does not re-cut the paper it came out of.
 *
 * Two channels off one curve, which is what keeps the sheet and the swarm
 * bleaching on the same clock: scrub a season and the colour drains out of the
 * butterflies *and* the newest cuts stop catching the light.
 */
export function freshnessOf(entry: Pick<Entry, "created">, today: DateLike): number {
  const left = saturationFor(seasonsSince(entry.created, today));
  return (left - SATURATION_FLOOR) / (1 - SATURATION_FLOOR);
}

/**
 * The saijiki, in the three states a kigo can be in on a given day.
 *
 *   `flying`      out of the fold and in the air: a butterfly
 *   `folded`      recorded, but its day has not turned yet: a square on the floor
 *   `unrecorded`  not written yet, as far as this day is concerned
 *
 * The third only ever has anything in it when the clock has been scrubbed
 * backwards, and it exists so that scrubbing back is honest. A kigo recorded
 * next March is not a folded square in January — it is nothing at all, because
 * it has not happened. Without this the scrubber would show a box holding
 * squares for entries nobody has written and a sheet cut for creatures nobody
 * has made, which is the one thing a record of what has happened must not do.
 */
export interface Divided {
  flying: Entry[];
  folded: Entry[];
  unrecorded: Entry[];
}

export function divide(saijiki: readonly Entry[], today: DateLike): Divided {
  const now = toDayNumber(today);
  const out: Divided = { flying: [], folded: [], unrecorded: [] };
  for (const entry of saijiki) {
    if (toDayNumber(entry.created) > now) out.unrecorded.push(entry);
    else if (hasEmerged(entry, today)) out.flying.push(entry);
    else out.folded.push(entry);
  }
  return out;
}

/**
 * Everyone whose paper has left the sheet: a hole apiece.
 *
 * Both of the recorded states, folded and flying, because the cut is made when
 * the entry is written and not when the creature comes out of it. A square on
 * the floor of the box has already left its silhouette behind.
 */
export function cut(saijiki: readonly Entry[], today: DateLike): Entry[] {
  const now = toDayNumber(today);
  return saijiki.filter((entry) => toDayNumber(entry.created) <= now);
}

/**
 * Who unfolds, given that the day has moved from `from` to `to`.
 *
 * Emergence is "the first open of a day later than the day it was written", and
 * that is a statement about two openings rather than about one day — so this
 * takes both. Anyone who was still a square when the widget was last looked at,
 * and is not one now, has a birth waiting.
 *
 * It is deliberately a *difference* rather than a test against today. Recording
 * one and scrubbing a day forward hatches it; scrubbing a season forward hatches
 * everyone recorded in that season, one after another; scrubbing backwards
 * hatches nobody, because nothing has come out — it has gone back in. And the
 * same rule covers the case the whole ceremony is for, which is the widget being
 * closed on one day and opened on a later one: `from` is then the day it was
 * last open, and the answer is the same shape.
 *
 * Nothing expires. However long the gap between `from` and `to`, whoever
 * crossed it is in this list.
 */
export function newlyEmerged(
  saijiki: readonly Entry[],
  from: DateLike,
  to: DateLike,
): Entry[] {
  if (toDayNumber(to) <= toDayNumber(from)) return [];
  return saijiki.filter((entry) => !hasEmerged(entry, from) && hasEmerged(entry, to));
}
