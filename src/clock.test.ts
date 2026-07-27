/// <reference types="vite/client" />

// Two things are pinned here.
//
// The first is the scrubber's arithmetic: forward and back must be exact
// inverses, and a season step must be worth exactly one season to the fading
// curve, because "scrub forward, watch the colour drain, scrub back, watch it
// return" is the whole point of the step this belongs to.
//
// The second is the rule the module exists to enforce, and it is not a unit
// test at all: nothing outside clock.ts may ask the machine what time it is. A
// single stray `new Date()` somewhere else does not fail anything — it quietly
// makes half the UI un-scrubbable, and the symptom looks like a bug in the
// fading curve. So it is checked by reading the source.

import { afterEach, describe, expect, it } from "vitest";
import {
  clockLabel,
  isScrubbed,
  onClockChange,
  resetClock,
  resetScrub,
  scrubDays,
  scrubLabel,
  scrubSeasons,
  setAnchor,
  systemToday,
  today,
} from "./clock";
import { saturationFor, seasonsSince, toISODate } from "./seasons";

afterEach(() => resetClock());

describe("the clock", () => {
  it("follows the machine when nothing has been asked of it", () => {
    expect(today()).toBe(toISODate(systemToday()));
    expect(isScrubbed()).toBe(false);
  });

  it("pins flat to an anchor, so a screenshot is the same picture next March", () => {
    setAnchor("2026-07-27");
    expect(today()).toBe("2026-07-27");
    expect(isScrubbed()).toBe(true);
    setAnchor(null);
    expect(today()).toBe(toISODate(systemToday()));
  });

  it("scrubs by days, and back", () => {
    setAnchor("2026-07-27");
    scrubDays(5);
    expect(today()).toBe("2026-08-01");
    scrubDays(-5);
    expect(today()).toBe("2026-07-27");
  });

  it("scrubs by seasons and lands on the boundary", () => {
    setAnchor("2026-07-27"); // summer/late
    scrubSeasons(1);
    expect(today()).toBe("2026-08-08"); // 立秋
    scrubSeasons(1);
    expect(today()).toBe("2026-11-07"); // 立冬
    scrubSeasons(-2);
    expect(today()).toBe("2026-05-06"); // back to the summer it started in
  });

  it("moves the fading curve by exactly one level per season step", () => {
    const created = "2026-07-27";
    setAnchor(created);
    const drained: number[] = [];
    for (let i = 0; i <= 5; i++) {
      drained.push(saturationFor(seasonsSince(created, today())));
      scrubSeasons(1);
    }
    expect(drained).toEqual([1, 0.85, 0.65, 0.5, 0.4, 0.4]);
  });

  it("restores exactly what scrubbing forward drained", () => {
    setAnchor("2026-07-27");
    const before = today();
    scrubSeasons(6);
    expect(today()).not.toBe(before);
    scrubSeasons(-6);
    // back to the season boundary, not to the anchor: a season step lands on
    // the boundary in both directions and says so
    expect(seasonsSince(before, today())).toBe(0);
    resetScrub();
    expect(today()).toBe(before);
  });

  it("tells listeners when the day moves, and stays quiet when it does not", () => {
    setAnchor("2026-07-27");
    let fired = 0;
    const off = onClockChange(() => fired++);
    scrubDays(1);
    expect(fired).toBe(1);
    scrubDays(0);
    expect(fired).toBe(1);
    off();
    scrubDays(1);
    expect(fired).toBe(1);
  });

  it("says plainly when what is on screen is not the real day", () => {
    expect(clockLabel()).not.toContain("SCRUBBED");
    expect(scrubLabel()).toBeNull();
    setAnchor("2026-07-27");
    scrubSeasons(2);
    expect(clockLabel()).toContain("SCRUBBED");
    expect(clockLabel()).toContain("2026-11-07");
    expect(clockLabel()).toContain("winter/early");
    expect(scrubLabel()).toContain("anchored 2026-07-27");
    expect(scrubLabel()).toContain("+103d");
  });

  it("keeps both lines short enough for a 420px overlay", () => {
    setAnchor("2026-07-27");
    scrubSeasons(-11);
    expect(clockLabel().length).toBeLessThan(48);
    expect(scrubLabel()!.length).toBeLessThan(48);
  });
});

// --- the rule ---------------------------------------------------------------

// Loaded as text rather than imported, because the point is what the source
// says and not what it does. `?raw` is a Vite feature and vitest runs through
// Vite, so this needs no filesystem access and no @types/node.
const sources = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// clock.ts is where the one call lives. Test files may ask the machine the time
// as much as they like — they are not the UI, and several of them exist
// precisely to check that a Date read the wrong way produces the wrong answer.
const ALLOWED = /^\.\/(clock\.ts|.*\.test\.ts)$/;

const READS_A_CLOCK = /\bnew Date\s*\(|\bDate\.now\s*\(/;

/**
 * The source with its comments taken out. Several files here talk *about* the
 * rule in prose, and a check that could not tell a sentence from a call would
 * be triggered by its own documentation.
 */
function codeOf(source: string): string[] {
  return source
    .split("\n")
    .map((line) => (/^\s*(\*|\/\/)/.test(line) ? "" : line.replace(/\/\/.*$/, "")));
}

describe("no clock but the clock", () => {
  it("finds every source file", () => {
    // If the glob ever silently matches nothing, the test below passes forever
    // while checking nothing at all.
    expect(Object.keys(sources).length).toBeGreaterThan(10);
    expect(sources["./clock.ts"]).toBeTypeOf("string");
  });

  it("has no new Date() or Date.now() outside clock.ts", () => {
    const offenders: string[] = [];
    for (const [path, source] of Object.entries(sources)) {
      if (ALLOWED.test(path)) continue;
      codeOf(source).forEach((code, i) => {
        if (READS_A_CLOCK.test(code)) offenders.push(`${path}:${i + 1}: ${code.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("keeps clock.ts to a single reading of the machine's date", () => {
    const calls = codeOf(sources["./clock.ts"]).filter((code) => READS_A_CLOCK.test(code));
    expect(calls).toEqual(["  return toCivil(new Date());"]);
  });
});
