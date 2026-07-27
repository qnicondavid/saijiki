// The seed rule, as a test.
//
// CLAUDE.md calls a broken seed rule "the single most expensive bug available
// in this codebase": a butterfly's appearance derives from its id and nothing
// else, so fixing a typo in an entry must not change the creature. Because
// deriveButterfly returns plain data, that invariant is checkable here with no
// canvas, no shim, and no screenshot to eyeball.

import { describe, expect, it } from "vitest";
import { deriveButterfly } from "./butterfly";

const IDS = [
  "k_7f3a9c",
  "k_0b41de",
  "k_c25a08",
  "k_913fb7",
  "k_4e6d20",
  "k_aa17f5",
  "k_2d8c63",
  "k_ff0192",
  "k_58b3ea",
  "k_31c74d",
  "k_9e02a6",
  "k_6417bb",
  "k_d3a58f",
  "k_08e961",
  "k_bc7204",
  "k_45fa39",
  "k_e19d70",
  "k_72b0c8",
  "k_a6531e",
  "k_1f8d47",
];

describe("deriveButterfly", () => {
  it("gives the same id the same creature, every time", () => {
    for (const id of IDS) {
      const a = deriveButterfly(id);
      const b = deriveButterfly(id);
      expect(a).not.toBe(b); // genuinely re-derived, not handed back a cache
      expect(a).toEqual(b);
    }
  });

  it("gives twenty ids twenty distinct creatures", () => {
    const seen = new Map<string, string>();
    for (const id of IDS) {
      const shape = JSON.stringify(deriveButterfly(id));
      const clash = seen.get(shape);
      expect(clash, `${id} is identical to ${clash}`).toBeUndefined();
      seen.set(shape, id);
    }
    expect(seen.size).toBe(IDS.length);
  });
});
