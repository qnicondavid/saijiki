// The collection, without a frame in it.
//
// Every answer this module gives is a function of dates, and all of them are
// load-bearing for something that is invisible when it goes wrong: a kigo in
// the wrong pile is a butterfly that never hatches, or a square that hatches
// twice, or a hole in the sheet for a cut nobody has made. None of those throw.

import { describe, expect, it } from "vitest";
import type { Kigo } from "./kigo-format";
import {
  cut,
  divide,
  fadeOf,
  newlyEmerged,
  toEntry,
  toSaijiki,
  wearOf,
  type Entry,
} from "./saijiki";
import { SATURATION_FLOOR, seasonOf } from "./seasons";

function kigo(id: string, created: string, touched: string[] = []): Kigo {
  return {
    schema: 1,
    id,
    created,
    season: seasonOf(created).bucketId,
    category: "humanity",
    paper: "#c94f3d",
    touched,
    text: `the one line of ${id}`,
    verses: [],
  };
}

const entry = (id: string, created: string, since = created, touches = 0): Entry => ({
  id,
  category: "humanity",
  created,
  since,
  touches,
});

describe("reading the store", () => {
  it("takes the two dates from the file, and the last touch is the second one", () => {
    const e = toEntry(kigo("k_1", "2026-02-11", ["2026-02-19", "2026-03-02"]));
    expect(e.created).toBe("2026-02-11");
    expect(e.since).toBe("2026-03-02");
  });

  // The alternative — an untouched kigo starting from nothing — would make the
  // recording ceremony produce a bleached butterfly, which is backwards.
  it("fades an untouched kigo from the day it was written", () => {
    const e = toEntry(kigo("k_1", "2026-02-11"));
    expect(e.since).toBe("2026-02-11");
    expect(fadeOf(e, "2026-02-11")).toBe(1);
  });

  it("carries the line, for the inside of the wings", () => {
    expect(toEntry(kigo("k_1", "2026-02-11")).text).toBe("the one line of k_1");
  });

  it("carries the verses under it, oldest first", () => {
    const k = kigo("k_1", "2026-02-11", ["2026-03-02", "2026-08-14"]);
    k.verses = [
      { text: "and dinner is longer now", date: "2026-03-02" },
      { text: "they made it through July", date: "2026-08-14" },
    ];
    expect(toEntry(k).verses).toEqual(["and dinner is longer now", "they made it through July"]);
  });

  it("leaves every verse date behind in the file", () => {
    // The file dates all of them and the wing shows none of them. How old a verse
    // is, is said by how faint its ink has gone — printing the date would add a
    // number to an app that has spent its whole design avoiding them, and it
    // would say worse what the fading already says well. So the dates do not
    // reach the picture at all: there is nothing downstream to remember not to
    // draw.
    const k = kigo("k_1", "2026-02-11", ["2026-03-02"]);
    k.verses = [
      { text: "and dinner is longer now", date: "2026-03-02" },
      { text: "a verse an older file never dated", date: null },
    ];
    // Words only, and the same shape whether the file dated the verse or not.
    expect(toEntry(k).verses).toEqual([
      "and dinner is longer now",
      "a verse an older file never dated",
    ]);
    expect(JSON.stringify(toEntry(k).verses)).not.toMatch(/\d/u);
  });

  it("gives a kigo with nothing written under it an empty list", () => {
    // Which is most of them, for the first year or two. Nothing downstream has to
    // ask whether there are any.
    expect(toEntry(kigo("k_1", "2026-02-11")).verses).toEqual([]);
  });

  it("keeps the store's order", () => {
    const all = toSaijiki([kigo("k_1", "2026-02-11"), kigo("k_2", "2025-11-30")]);
    expect(all.map((e) => e.id)).toEqual(["k_1", "k_2"]);
  });
});

describe("the fade", () => {
  // CLAUDE.md's table, exactly. Seasonal and never daily: three days running
  // must show no visible delta, and a season must show one.
  it("walks CLAUDE.md's five steps and stops at the floor", () => {
    const e = entry("k_1", "2026-02-11");
    const at = (day: string) => fadeOf(e, day);
    expect(at("2026-02-11")).toBe(1); // spring, the season it was written in
    expect(at("2026-05-01")).toBe(1); // still spring
    expect(at("2026-05-06")).toBe(0.85); // summer
    expect(at("2026-08-08")).toBe(0.65); // autumn
    expect(at("2026-11-07")).toBe(0.5); // winter
    expect(at("2027-02-04")).toBe(SATURATION_FLOOR);
    expect(at("2031-02-04")).toBe(SATURATION_FLOOR); // and never lower. nothing dies
  });

  it("counts from the last touch, not from the day it began", () => {
    const begun = entry("k_1", "2024-02-11");
    const touched = entry("k_1", "2024-02-11", "2026-02-11");
    // Two years apart in age, and the touched one is at full colour: the mixed
    // case the two channels exist to keep readable.
    expect(fadeOf(begun, "2026-03-01")).toBe(SATURATION_FLOOR);
    expect(fadeOf(touched, "2026-03-01")).toBe(1);
  });
});

describe("the wear", () => {
  // The channel that does not read a clock. Colour says how long since; this
  // says how often, ever — and the two have to be able to disagree, because the
  // mixed cases are the ones worth being able to tell apart.
  it("counts the touches off the file", () => {
    expect(toEntry(kigo("k_1", "2026-02-11")).touches).toBe(0);
    expect(toEntry(kigo("k_1", "2026-02-11", ["2026-02-19", "2026-03-02"])).touches).toBe(2);
  });

  it("steps, and never in between", () => {
    const at = (touches: number) => wearOf({ touches });
    expect(at(0)).toBe(0); // never picked up: a fresh scissor edge
    expect(at(1)).toBe(1); // the first touch has to register
    expect(at(2)).toBe(1);
    expect(at(3)).toBe(2);
    expect(at(5)).toBe(2);
    expect(at(6)).toBe(3);
    expect(at(400)).toBe(3); // and no further: four steps is the whole scale
  });

  it("only ever goes up", () => {
    let previous = -1;
    for (let touches = 0; touches < 200; touches++) {
      const now = wearOf({ touches });
      expect(now).toBeGreaterThanOrEqual(previous);
      previous = now;
    }
  });

  it("is not a second reading of the fade", () => {
    // The pair that would look identical under one channel and tells two
    // different stories under two: both begun two years ago, both a season
    // stale, one held a dozen times and one written down and left.
    const loved = entry("k_1", "2024-02-11", "2026-02-11", 12);
    const left = entry("k_2", "2024-02-11", "2026-02-11", 0);
    expect(fadeOf(loved, "2026-08-01")).toBe(fadeOf(left, "2026-08-01"));
    expect(wearOf(loved)).not.toBe(wearOf(left));
    // and the reverse: the same handling, a season apart in colour
    const fresh = entry("k_3", "2024-02-11", "2026-08-01", 12);
    expect(wearOf(fresh)).toBe(wearOf(loved));
    expect(fadeOf(fresh, "2026-08-01")).not.toBe(fadeOf(loved, "2026-08-01"));
  });

  it("survives being left alone, which colour does not", () => {
    // "Wear signifies affection, not damage." The colour comes back on a touch
    // and drains again when it is not; the softness of a much-handled thing is
    // not something that can be undone by neglect, and nothing here can take it
    // away — the store only ever appends to `touched`.
    const held = entry("k_1", "2024-02-11", "2024-06-01", 9);
    expect(fadeOf(held, "2024-06-01")).toBe(1);
    expect(fadeOf(held, "2031-01-01")).toBe(SATURATION_FLOOR);
    expect(wearOf(held)).toBe(3);
  });
});

describe("dividing the day", () => {
  const saijiki = [
    entry("k_old", "2025-06-01"),
    entry("k_yesterday", "2026-02-10"),
    entry("k_today", "2026-02-11"),
    entry("k_later", "2026-03-04"),
  ];

  it("flies whatever was written before today and folds what was written on it", () => {
    const { flying, folded } = divide(saijiki, "2026-02-11");
    expect(flying.map((e) => e.id)).toEqual(["k_old", "k_yesterday"]);
    expect(folded.map((e) => e.id)).toEqual(["k_today"]);
  });

  // Strictly later, not "at least a day": the promise is *the next day you open
  // it*, and something recorded at one minute past midnight has still only been
  // recorded today.
  it("hatches the square the day after, whatever the hour was", () => {
    expect(divide([entry("k_1", "2026-02-11")], "2026-02-11").folded).toHaveLength(1);
    expect(divide([entry("k_1", "2026-02-11")], "2026-02-12").flying).toHaveLength(1);
  });

  // Scrubbing backwards past the day a kigo was written must not leave a square
  // lying on the floor of a box for something nobody has written yet.
  it("has nothing at all for a kigo whose day has not come round", () => {
    const day = divide(saijiki, "2026-02-11");
    expect(day.unrecorded.map((e) => e.id)).toEqual(["k_later"]);
    expect([...day.flying, ...day.folded].map((e) => e.id)).not.toContain("k_later");
  });

  it("puts every kigo in exactly one pile", () => {
    for (const today of ["2024-01-01", "2026-02-11", "2030-01-01"]) {
      const { flying, folded, unrecorded } = divide(saijiki, today);
      expect(flying.length + folded.length + unrecorded.length).toBe(saijiki.length);
      const ids = [...flying, ...folded, ...unrecorded].map((e) => e.id).sort();
      expect(ids).toEqual(saijiki.map((e) => e.id).sort());
    }
  });

  it("is empty in every pile for an empty store", () => {
    expect(divide([], "2026-02-11")).toEqual({ flying: [], folded: [], unrecorded: [] });
  });
});

describe("what the sheet has lost", () => {
  const saijiki = [
    entry("k_old", "2025-06-01"),
    entry("k_today", "2026-02-11"),
    entry("k_later", "2026-03-04"),
  ];

  // The cut is made when the entry is written, not when the creature comes out
  // of it — so a square on the floor has already left its silhouette behind.
  it("counts the folded square as well as the butterfly", () => {
    expect(cut(saijiki, "2026-02-11").map((e) => e.id)).toEqual(["k_old", "k_today"]);
  });

  it("shows no cut that has not been made", () => {
    expect(cut(saijiki, "2025-01-01")).toEqual([]);
    expect(cut(saijiki, "2026-03-04")).toHaveLength(3);
  });
});

describe("who unfolds", () => {
  const saijiki = [
    entry("k_old", "2025-06-01"),
    entry("k_mon", "2026-02-09"),
    entry("k_tue", "2026-02-10"),
  ];

  it("is whoever stopped being a square between the two days", () => {
    // Written Monday, the widget last open on Monday, opened again on Tuesday.
    expect(newlyEmerged(saijiki, "2026-02-09", "2026-02-10").map((e) => e.id)).toEqual(["k_mon"]);
  });

  it("does not hatch anyone twice", () => {
    expect(newlyEmerged(saijiki, "2026-02-10", "2026-02-11").map((e) => e.id)).toEqual(["k_tue"]);
    expect(newlyEmerged(saijiki, "2026-02-11", "2026-02-12")).toEqual([]);
  });

  // "Never expire it — however long they take, the birth is waiting."
  it("waits however long it takes", () => {
    expect(newlyEmerged(saijiki, "2026-02-10", "2029-07-01").map((e) => e.id)).toEqual(["k_tue"]);
  });

  it("hatches several at once when several were waiting", () => {
    expect(newlyEmerged(saijiki, "2026-02-09", "2026-02-12").map((e) => e.id)).toEqual([
      "k_mon",
      "k_tue",
    ]);
  });

  it("hatches nobody going backwards, or standing still", () => {
    expect(newlyEmerged(saijiki, "2026-02-12", "2026-02-09")).toEqual([]);
    expect(newlyEmerged(saijiki, "2026-02-12", "2026-02-12")).toEqual([]);
  });
});
