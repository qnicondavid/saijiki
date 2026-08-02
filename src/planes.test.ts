// The depth model, without a frame in it.
//
// Everything here is either arithmetic on a date or a row of a table, which is
// exactly why it is worth pinning: a plane count, a scale ladder and a haze
// curve are load-bearing for the tile cache and for whether the box reads as a
// box, and every one of them fails in a way that looks like "the depth needs
// more tuning" rather than like a bug.

import { describe, expect, it } from "vitest";
import { FLIGHT, flightBounds } from "./flight";
import { planeBounds, planeCount, planeOf, planeTable } from "./planes";
import { bucketsSince } from "./seasons";

describe("depth planes", () => {
  const bounds = flightBounds(420, 300);

  // The three numbers the whole recession is measured back from live in FLIGHT,
  // and planes.ts keeps its own copy for the case where it is imported alone.
  // This is what stops the two drifting apart in silence.
  it("is built from the near plane's own numbers", () => {
    const glass = planeTable()[0];
    expect(glass.scale).toBe(FLIGHT.wingspan);
    expect(glass.phases).toBe(FLIGHT.beat.phases);
    expect(glass.rest).toBe(FLIGHT.rest.fraction);
  });

  it("puts a kigo begun today at the glass and one begun years ago at the back", () => {
    expect(planeOf(0)).toBe(0);
    expect(planeOf(bucketsSince("2020-01-01", "2026-08-08"))).toBe(planeCount() - 1);
  });

  it("gives kigo from the same bucket the same plane", () => {
    // CLAUDE.md: "Buckets are also the depth-clustering unit for rendering."
    // Every day inside autumn/early is the same distance back as every other.
    const today = "2026-11-20";
    const within = ["2026-08-08", "2026-08-20", "2026-09-01", "2026-09-07"];
    const ages = within.map((d) => bucketsSince(d, today));
    expect(new Set(ages).size).toBe(1);
    expect(new Set(ages.map(planeOf)).size).toBe(1);
  });

  it("gives every plane its own discrete scale, and no more scales than planes", () => {
    // The property the whole tile cache rests on. `scale` is part of the cache
    // key, so it has to take a handful of values rather than a continuum — a
    // butterfly whose size eased smoothly with its depth would mint a fresh
    // sprite sheet on every frame of every scrub.
    const scales = planeTable().map((p) => p.scale);
    expect(scales.length).toBe(planeCount());
    expect(new Set(scales).size).toBe(planeCount());
    expect(scales[0]).toBe(FLIGHT.wingspan);
    // and each is genuinely rounded to what the cache key will read
    for (const s of scales) expect(s).toBe(Number(s.toFixed(2)));
    // strictly receding
    for (let i = 1; i < scales.length; i++) expect(scales[i]).toBeLessThan(scales[i - 1]);
  });

  it("drops wingbeat tiles in step with the wingspan, so the stepping stays even", () => {
    const table = planeTable();
    // What a phase costs the eye is how far the wing tip jumps between tiles,
    // and that is proportional to (wingspan / phases). Holding it roughly
    // constant across the box is what makes fewer phases at the back invisible
    // rather than merely cheaper.
    const jump = table.map((p) => p.scale / p.phases);
    for (const j of jump) expect(j).toBeCloseTo(jump[0], 0.5);
    for (let i = 1; i < table.length; i++) {
      expect(table[i].phases).toBeLessThanOrEqual(table[i - 1].phases);
    }
    expect(table[table.length - 1].phases).toBeLessThan(table[0].phases);
  });

  it("narrows the box with depth, and keeps every plane inside the near one", () => {
    // Scale alone does not read as distance — a small butterfly in the corner
    // of the full sheet is a small butterfly. The inset is the wall.
    const near = planeBounds(bounds, 0);
    expect(near).toEqual(bounds);
    let previous = near;
    for (let p = 1; p < planeCount(); p++) {
      const rect = planeBounds(bounds, p);
      expect(rect.w).toBeLessThan(previous.w);
      expect(rect.h).toBeLessThan(previous.h);
      expect(rect.x).toBeGreaterThan(previous.x);
      expect(rect.y).toBeGreaterThan(previous.y);
      expect(rect.x + rect.w).toBeLessThan(previous.x + previous.w);
      expect(rect.y + rect.h).toBeLessThan(previous.y + previous.h);
      previous = rect;
    }
    // and the back wall still has room to fly in
    expect(previous.w).toBeGreaterThan(FLIGHT.wingspan * 3);
  });

  it("settles more of the far planes than the near one", () => {
    const rest = planeTable().map((p) => p.rest);
    expect(rest[0]).toBe(FLIGHT.rest.fraction);
    for (let i = 1; i < rest.length; i++) expect(rest[i]).toBeGreaterThan(rest[i - 1]);
    expect(rest[rest.length - 1]).toBeLessThanOrEqual(1);
  });

  it("recedes without ever reaching for a blur", () => {
    // CLAUDE.md forbids gaussian depth outright. Recession is a wash of the
    // sheet's own colour, a smaller creature and a longer shadow — all three
    // are here, and there is nowhere for a blur to hide.
    const table = planeTable();
    const back = table[table.length - 1].look;
    expect(table[0].look.haze).toBe(0);
    expect(back.haze).toBeGreaterThan(0.15);
    expect(back.haze).toBeLessThan(0.6); // past this the paper stops being paper
    expect(back.shadowScale).toBeGreaterThan(1); // longer and wider, not tighter
    expect(back.shadowAlpha).toBeLessThan(1); // and fainter
    for (let i = 1; i < table.length; i++) {
      expect(table[i].look.haze).toBeGreaterThan(table[i - 1].look.haze);
      expect(table[i].look.key).not.toBe(table[i - 1].look.key);
    }
  });
});
