// The back sheet, and how much of it is left.
//
// Two kinds of claim here, and the second is the reason this file exists.
//
// The bookkeeping is ordinary: a hole appears when an entry is written, stays
// when the day moves, and goes when the clock is scrubbed back past the day the
// cut was made. None of that is visible until it is wrong.
//
// The density is not ordinary. "A hundred and fifty silhouettes may read as
// lace, or may read as damage" is a question with a number behind it, and the
// number is easy to be wrong about by an order of magnitude in either
// direction — this was, at first, by a factor of five. So it is measured here,
// by rasterising the actual silhouettes at the actual placement onto a grid the
// shape of the actual sheet, and the answer is pinned. A constant that quietly
// drifts back up is a sheet that quietly stops being a sheet.

import { beforeEach, describe, expect, it } from "vitest";
import { deriveButterfly, type Pt } from "./butterfly";
import { FLIGHT } from "./flight";
import { HOLES, clearHoles, cutHole, cuttingCount, holeAt, holeCount, setHoles, stepHoles } from "./holes";
import { mulberry32 } from "./noise";
import { sheetRect } from "./paper";
import { PLANES } from "./planes";

const sheet = sheetRect(420, 300);

/** Ids in mintId's own shape, so the placement stream sees what it will see. */
function ids(n: number): string[] {
  const r = mulberry32(0x5a1_71c1);
  const out: string[] = [];
  while (out.length < n) {
    const id = `k_${Math.floor(r() * 0xffffff).toString(16).padStart(6, "0")}`;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

const cuts = (list: readonly string[], fresh = 0) => list.map((id) => ({ id, fresh }));

beforeEach(() => {
  clearHoles();
});

describe("what is in the sheet", () => {
  it("is one hole for one entry, and none for none", () => {
    expect(holeCount()).toBe(0);
    setHoles(cuts(["k_1"]));
    expect(holeCount()).toBe(1);
  });

  it("takes the whole set at once and reconciles by id", () => {
    setHoles(cuts(["k_1", "k_2", "k_3"]));
    expect(holeCount()).toBe(3);
    // The clock has been scrubbed back past two of them: the sheet cannot show
    // a cut that has not been made.
    setHoles(cuts(["k_1"]));
    expect(holeCount()).toBe(1);
    setHoles(cuts(["k_1", "k_2", "k_3"]));
    expect(holeCount()).toBe(3);
  });

  // An app that opened by re-cutting a hundred and fifty holes would be a very
  // strange way to say "here is your sheet".
  it("finds a hole it has never seen already open", () => {
    setHoles(cuts(ids(150)));
    expect(cuttingCount()).toBe(0);
  });

  // The entry is written to disk before the paper moves, so `setHoles` has
  // already listed this kigo by the time the blade goes in.
  it("re-opens the one the ceremony is cutting now", () => {
    setHoles(cuts(["k_1"]));
    cutHole("k_1");
    expect(cuttingCount()).toBe(1);
    stepHoles(HOLES.cutSec * 0.5);
    expect(cuttingCount()).toBe(1);
    stepHoles(HOLES.cutSec);
    expect(cuttingCount()).toBe(0);
    expect(holeCount()).toBe(1);
  });

  it("does not re-cut a hole when the day moves under it", () => {
    setHoles(cuts(["k_1"]));
    cutHole("k_1");
    stepHoles(HOLES.cutSec * 0.4);
    setHoles(cuts(["k_1", "k_2"])); // a scrub, mid-cut
    expect(cuttingCount()).toBe(1); // and only the one that was under the blade
    stepHoles(HOLES.cutSec);
    expect(cuttingCount()).toBe(0);
  });
});

describe("where a hole is", () => {
  const all = ids(150);

  it("is the same place on every machine, forever", () => {
    expect(holeAt("k_7f3a9c", sheet)).toEqual(holeAt("k_7f3a9c", sheet));
  });

  // Derived from the sheet rather than remembered, so the sheet can be any size
  // and the holes are still in it.
  it("moves with the sheet and survives a resize", () => {
    const big = sheetRect(840, 600);
    for (const id of all.slice(0, 40)) {
      const at = holeAt(id, big);
      const e = deriveButterfly(id).extent;
      expect(at.x + e.minX * at.scale).toBeGreaterThanOrEqual(big.x);
      expect(at.x + e.maxX * at.scale).toBeLessThanOrEqual(big.x + big.w);
      expect(at.y + e.minY * at.scale).toBeGreaterThanOrEqual(big.y);
      expect(at.y + e.maxY * at.scale).toBeLessThanOrEqual(big.y + big.h);
      expect(at.scale).toBeCloseTo(big.w * HOLES.size, 6);
    }
  });

  it("never hangs off the paper", () => {
    for (const id of all) {
      const at = holeAt(id, sheet);
      const e = deriveButterfly(id).extent;
      expect(at.x + e.minX * at.scale).toBeGreaterThanOrEqual(sheet.x);
      expect(at.x + e.maxX * at.scale).toBeLessThanOrEqual(sheet.x + sheet.w);
      expect(at.y + e.minY * at.scale).toBeGreaterThanOrEqual(sheet.y);
      expect(at.y + e.maxY * at.scale).toBeLessThanOrEqual(sheet.y + sheet.h);
    }
  });

  it("does not put two creatures in the same place", () => {
    const places = new Set(all.map((id) => {
      const at = holeAt(id, sheet);
      return `${at.x.toFixed(3)},${at.y.toFixed(3)}`;
    }));
    expect(places.size).toBe(all.length);
  });
});

// --- the density -------------------------------------------------------------
//
// The measurement, run for real. `cut` is the fraction of the sheet's area that
// is no longer paper, by rasterising every silhouette at its own placement and
// counting. `islands` and `biggest` are the shredding check: a sheet can lose a
// modest area and still be ruined if what is left is threads, so the surviving
// paper has to stay essentially one connected piece.
//
// Against a hundred and fifty synthetic kigo, over the whole sheet:
//
//   size 0.14 (as first shipped)   56%, and 77% of the narrow band it used
//   size 0.06                      21%
//   size 0.05 (shipped)            16%
//   size 0.04                      10%
//
// The bounds below are deliberately wider than the shipped value. Which point
// in that range looks best is taste, and it is on a slider; a sheet that has
// lost a third of itself is not taste, and that is what this catches.

interface Coverage {
  cut: number;
  islands: number;
  biggest: number;
}

// Two polygons that share an edge can leave a single unsampled cell between
// them, which is a fact about sampling on cell centres and not about paper.
// Anything this small is not a scrap you could pick up.
const SPECK = 4;

function measure(list: readonly string[]): Coverage {
  const w = Math.round(sheet.w);
  const h = Math.round(sheet.h);
  const grid = new Uint8Array(w * h);

  const fill = (poly: readonly Pt[], ox: number, oy: number, scale: number) => {
    const xs = poly.map((p) => ox + p.x * scale - sheet.x);
    const ys = poly.map((p) => oy + p.y * scale - sheet.y);
    const from = Math.max(0, Math.floor(Math.min(...ys)));
    const to = Math.min(h - 1, Math.ceil(Math.max(...ys)));
    for (let row = from; row <= to; row++) {
      const y = row + 0.5;
      const hits: number[] = [];
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        if (ys[i] <= y === ys[j] <= y) continue;
        hits.push(xs[i] + ((y - ys[i]) / (ys[j] - ys[i])) * (xs[j] - xs[i]));
      }
      hits.sort((a, b) => a - b);
      for (let k = 0; k + 1 < hits.length; k += 2) {
        const a = Math.max(0, Math.ceil(hits[k] - 0.5));
        const b = Math.min(w - 1, Math.floor(hits[k + 1] - 0.5));
        for (let col = a; col <= b; col++) grid[row * w + col] = 1;
      }
    }
  };

  for (const id of list) {
    const spec = deriveButterfly(id);
    const at = holeAt(id, sheet);
    for (const panel of spec.panels) fill(panel.outline, at.x, at.y, at.scale);
    fill(spec.body.outline, at.x, at.y, at.scale);
  }

  let gone = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i]) gone++;

  // Connected components of the paper that is left.
  const seen = new Uint8Array(grid.length);
  const stack: number[] = [];
  let islands = 0;
  let biggest = 0;
  for (let start = 0; start < grid.length; start++) {
    if (grid[start] || seen[start]) continue;
    let size = 0;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const at = stack.pop()!;
      size++;
      const row = (at / w) | 0;
      const col = at % w;
      const push = (i: number) => {
        if (!grid[i] && !seen[i]) {
          seen[i] = 1;
          stack.push(i);
        }
      };
      if (col > 0) push(at - 1);
      if (col + 1 < w) push(at + 1);
      if (row > 0) push(at - w);
      if (row + 1 < h) push(at + w);
    }
    if (size >= SPECK) islands++;
    if (size > biggest) biggest = size;
  }

  const left = grid.length - gone;
  return { cut: gone / grid.length, islands, biggest: left > 0 ? biggest / left : 0 };
}

describe("how much of the sheet is left", () => {
  // The empty state, and the first several months of real use. This is the one
  // that has to be lovely, and the only way it can fail is by being invisible.
  it("takes almost nothing for the first few entries", () => {
    const first = measure(ids(3));
    expect(first.cut).toBeLessThan(0.01);
    expect(first.islands).toBe(1); // one sheet, with three creatures out of it
    const one = holeAt("k_7f3a9c", sheet);
    expect(one.scale).toBeGreaterThan(10); // and a silhouette you can read
  });

  it("is still a sheet at a hundred and fifty", () => {
    const full = measure(ids(150));
    // Worked, not ruined. The lower bound matters as much as the upper one: a
    // sheet nobody can see has been cut is not a record of anything.
    expect(full.cut).toBeGreaterThan(0.04);
    expect(full.cut).toBeLessThan(0.25);
    // And what is left is one piece of paper, not confetti.
    expect(full.biggest).toBeGreaterThan(0.98);
  });

  // The size this started at, kept as the reason it moved. If it is ever put
  // back, this is what it costs.
  it("would lose more than a third of the sheet at the size it started", () => {
    const was = HOLES.size;
    try {
      HOLES.size = 0.14;
      expect(measure(ids(150)).cut).toBeGreaterThan(0.3);
    } finally {
      HOLES.size = was;
    }
  });

  // Perspective, and the range the size has to sit in: a creature lying on the
  // back wall cannot be bigger than the same creature at the glass, and cannot
  // be smaller than one at the back of the box.
  it("cuts a silhouette the size of a butterfly somewhere in the box", () => {
    const glass = FLIGHT.wingspan;
    const back = glass * PLANES.farScale;
    expect(sheet.w * HOLES.size).toBeGreaterThanOrEqual(back);
    expect(sheet.w * HOLES.size).toBeLessThanOrEqual(glass);
  });
});
