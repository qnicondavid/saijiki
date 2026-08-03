// Emergence, without a frame in it.
//
// The shape moving is not the part that can be wrong — a wing at the wrong
// angle is something you look at and fix. What can be wrong and stay wrong is
// the bookkeeping: a queue that overlaps, a birth that happens twice, one that
// never ends, or a creature handed to the swarm somewhere other than where it
// was last drawn. All of those look like a glitch and none of them throw.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Where a creature was handed to the swarm, caught on the way past. Through the
// real call rather than a stub of it, because "flight was told" and "flight
// listened" are two different claims and only the second one matters.
const handed = vi.hoisted(() => [] as Array<{ id: string; x: number; y: number }>);

vi.mock("./flight", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./flight")>();
  return {
    ...actual,
    enterFlightAt(id: string, at: { x: number; y: number }) {
      handed.push({ id, x: at.x, y: at.y });
      actual.enterFlightAt(id, at);
    },
  };
});

import { EMERGE, beatOf, clearHatching, hatch, hatchingCount, isHatching, stepEmergence } from "./emergence";
import { flightBounds } from "./flight";
import { sheetRect } from "./paper";

const sheet = sheetRect(420, 300);
const bounds = flightBounds(420, 300);

const one = (id: string) => ({ id, category: "humanity" as const, fade: 1 });

/** Run the clock forward in frames, collecting whoever finished. */
function run(seconds: number, step = 1 / 60): string[] {
  const done: string[] = [];
  for (let t = 0; t < seconds; t += step) {
    stepEmergence(step, sheet, bounds, (id) => done.push(id));
  }
  return done;
}

function total(): number {
  return EMERGE.waitSec + EMERGE.unfoldSec + EMERGE.restSec + EMERGE.riseSec;
}

beforeEach(() => {
  clearHatching();
  handed.length = 0;
});

describe("the four beats", () => {
  it("runs them in order and finishes exactly once", () => {
    const E = EMERGE;
    expect(beatOf(0).beat).toBe("waiting");
    expect(beatOf(E.waitSec + 0.01).beat).toBe("unfolding");
    expect(beatOf(E.waitSec + E.unfoldSec + 0.01).beat).toBe("resting");
    expect(beatOf(E.waitSec + E.unfoldSec + E.restSec + 0.01).beat).toBe("rising");
    expect(beatOf(total() - 0.01).done).toBe(false);
    expect(beatOf(total() + 0.01).done).toBe(true);
  });

  it("keeps its parameter inside the unit interval at every moment", () => {
    for (let t = 0; t < total() + 1; t += 0.017) {
      const at = beatOf(t);
      expect(at.u).toBeGreaterThanOrEqual(0);
      expect(at.u).toBeLessThanOrEqual(1);
    }
  });

  // The two beats that do nothing are the two most easily deleted, so they are
  // pinned: a square that began opening the instant it appeared would be a thing
  // reacting to being looked at, and one that left the moment it was flat would
  // be a transition rather than a birth.
  it("holds still at both ends of the unfold", () => {
    expect(EMERGE.waitSec).toBeGreaterThan(0);
    expect(EMERGE.restSec).toBeGreaterThan(0);
  });
});

describe("the queue", () => {
  it("hatches one, and then it is a butterfly", () => {
    hatch([one("k_1")]);
    expect(isHatching("k_1")).toBe(true);
    const done = run(total() + 0.2);
    expect(done).toEqual(["k_1"]);
    expect(isHatching("k_1")).toBe(false);
    expect(hatchingCount()).toBe(0);
  });

  // "Stagger them rather than hatching a batch at once, and let each one have
  // its moment." The moment is the unfold, so no two may be unfolding together.
  it("never has two opening at the same time", () => {
    hatch([one("k_1"), one("k_2"), one("k_3")]);
    expect(EMERGE.gapSec).toBeGreaterThan(EMERGE.waitSec + EMERGE.unfoldSec);
  });

  it("finishes them one after another, in the order they were given", () => {
    hatch([one("k_1"), one("k_2"), one("k_3")]);
    const done = run(total() + EMERGE.gapSec * 3);
    expect(done).toEqual(["k_1", "k_2", "k_3"]);
  });

  it("appends a second batch behind the first instead of overlapping it", () => {
    hatch([one("k_1")]);
    run(0.3);
    hatch([one("k_2")]);
    const done = run(total() + EMERGE.gapSec * 2);
    expect(done).toEqual(["k_1", "k_2"]);
  });

  it("ignores a kigo that is already in the queue", () => {
    hatch([one("k_1")]);
    hatch([one("k_1")]);
    expect(hatchingCount()).toBe(1);
  });

  it("does nothing at all with nobody waiting", () => {
    hatch([]);
    expect(hatchingCount()).toBe(0);
    expect(run(5)).toEqual([]);
  });

  // However long they take, the birth is waiting — so a queue does not drain
  // while nothing is being drawn. A stopped render loop is a paused ceremony.
  it("does not advance on a frame that took no time", () => {
    hatch([one("k_1")]);
    stepEmergence(0, sheet, bounds, () => {});
    expect(isHatching("k_1")).toBe(true);
  });

  it("leaves nobody half-born when it is cleared", () => {
    hatch([one("k_1"), one("k_2")]);
    run(1);
    clearHatching();
    expect(hatchingCount()).toBe(0);
    expect(run(total() + 1)).toEqual([]);
  });
});

// A birth that ended by putting its creature somewhere else in the box would
// undo the whole ceremony in one frame, and it would look like a flicker rather
// than like a bug. So the hand-off is checked rather than assumed.
describe("the hand-off", () => {
  it("gives the swarm the point it was last drawn at", () => {
    hatch([one("k_7f3a9c")]);
    run(total() + 0.2);
    expect(handed).toHaveLength(1);
    expect(handed[0].id).toBe("k_7f3a9c");
    expect(handed[0].x).toBeGreaterThanOrEqual(bounds.x);
    expect(handed[0].x).toBeLessThanOrEqual(bounds.x + bounds.w);
    expect(handed[0].y).toBeGreaterThanOrEqual(bounds.y);
    expect(handed[0].y).toBeLessThanOrEqual(bounds.y + bounds.h);
  });

  // Off the id, so a kigo watched twice is born into the same corner twice.
  it("is the same corner of the box every time", () => {
    hatch([one("k_7f3a9c")]);
    run(total() + 0.2);
    clearHatching();
    hatch([one("k_7f3a9c")]);
    run(total() + 0.2);
    expect(handed[0]).toEqual(handed[1]);
  });

  it("gives different creatures different corners", () => {
    hatch([one("k_7f3a9c"), one("k_0b41de"), one("k_c25a08")]);
    run(total() + EMERGE.gapSec * 3);
    const places = new Set(handed.map((h) => `${h.x.toFixed(2)},${h.y.toFixed(2)}`));
    expect(places.size).toBe(3);
  });
});
