// Eight papers on a cream sheet, and every one of them has to be visible.
//
// `muki` failed this by eye: undyed flax rendered as a pale warm greige sat at
// roughly 2.1:1 against the lightest sheet variant while the other seven ran
// 2.7–4.2:1, so it read as a smudge on the paper rather than as a piece of
// paper. "Looks a bit faint" is not a regression anyone catches twice, so the
// floor is pinned here instead.
//
// This is a legibility floor, not an accessibility target: these are dyed
// papers in a quiet diorama, and a ceiling matters as much as a floor — a
// category that shouted would break the constitution's "warm and muted".

import { describe, expect, it } from "vitest";
import { CATEGORIES, CATEGORY_PAPERS, paletteFor } from "./papers";
import { PAPER } from "./paper";
import { saturationFor } from "./seasons";

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

// WCAG relative luminance. Used here as a perceptual yardstick, not because
// anything in this app is text.
function luminance([r, g, b]: RGB): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// the worst case is the palest sheet a butterfly can be laid on
const palestSheet = PAPER.variants.reduce((best, v) =>
  luminance(v.base) > luminance(best.base) ? v : best,
).base;

describe("category papers", () => {
  it("all hold their own against the palest sheet", () => {
    for (const category of CATEGORIES) {
      const ratio = contrast(hexToRgb(CATEGORY_PAPERS[category]), palestSheet);
      expect(ratio, `${category} is too faint against the sheet`).toBeGreaterThan(2.5);
      expect(ratio, `${category} shouts`).toBeLessThan(5);
    }
  });

  // The specific bug: muki is one of eight categories, not an edge case, and it
  // must not be the obvious runt of the set.
  it("keeps muki within reach of the rest of the set", () => {
    const ratios = CATEGORIES.map((c) => contrast(hexToRgb(CATEGORY_PAPERS[c]), palestSheet));
    const muki = contrast(hexToRgb(CATEGORY_PAPERS.muki), palestSheet);
    const median = ratios.slice().sort((a, b) => a - b)[Math.floor(ratios.length / 2)];
    expect(Math.abs(muki - median)).toBeLessThan(0.8);
  });

  // Undyed is the *least* dyed, not merely the palest: chroma is what should
  // set muki apart, and that is the property that survives being darkened.
  it("leaves muki the least saturated paper", () => {
    const chroma = (hex: string) => {
      const c = hexToRgb(hex);
      return Math.max(...c) - Math.min(...c);
    };
    for (const category of CATEGORIES) {
      if (category === "muki") continue;
      expect(chroma(CATEGORY_PAPERS.muki)).toBeLessThan(chroma(CATEGORY_PAPERS[category]));
    }
  });

  it("gives every category a cut edge paler than its face", () => {
    for (const category of CATEGORIES) {
      const p = paletteFor(category);
      expect(luminance(p.lit)).toBeGreaterThan(luminance(p.base));
      expect(luminance(p.dark)).toBeLessThan(luminance(p.base));
    }
  });
});

// --- fading -----------------------------------------------------------------
//
// The fade table in CLAUDE.md is a saturation table, and this is where it meets
// the paper. Two things are pinned: that the dye actually drains, and that it
// drains into a *small, fixed* set of palettes.
//
// The second is not tidiness. The palette key is part of the tile cache key, so
// one palette per butterfly would mean one sprite sheet per butterfly, and a
// hundred and fifty entries times fourteen poses would go straight through a
// cache of two thousand and thrash forever. Five levels keeps it at forty.

const FADE_LEVELS = [0, 1, 2, 3, 4].map(saturationFor);

describe("sun-bleaching", () => {
  it("takes chroma out and leaves lightness alone", () => {
    for (const category of CATEGORIES) {
      if (category === "muki") continue; // already near-grey; the margins are too fine to pin
      const fresh = paletteFor(category, 1);
      const faded = paletteFor(category, saturationFor(4));
      const chroma = (c: RGB) => Math.max(...c) - Math.min(...c);
      expect(chroma(faded.base), category).toBeLessThan(chroma(fresh.base));
      // within a rounding step or two: this is a chroma change, not a fade to white
      expect(Math.abs(luminance(faded.base) - luminance(fresh.base))).toBeLessThan(0.02);
    }
  });

  it("only ever drains, never the other way", () => {
    for (const category of CATEGORIES) {
      let previous = Infinity;
      for (const s of FADE_LEVELS) {
        const chroma = (c: RGB) => Math.max(...c) - Math.min(...c);
        const now = chroma(paletteFor(category, s).base);
        expect(now, `${category} at ${s}`).toBeLessThanOrEqual(previous);
        previous = now;
      }
    }
  });

  it("keeps the cut edge paler than the face however faded the paper is", () => {
    for (const category of CATEGORIES) {
      for (const s of FADE_LEVELS) {
        const p = paletteFor(category, s);
        expect(luminance(p.lit), `${category} at ${s}`).toBeGreaterThan(luminance(p.base));
        expect(luminance(p.dark), `${category} at ${s}`).toBeLessThan(luminance(p.base));
      }
    }
  });

  it("holds every category above the legibility floor even on the hard floor", () => {
    // "Nothing dies." A butterfly left alone for four seasons has to still be a
    // piece of coloured paper on a cream sheet, not a smudge.
    for (const category of CATEGORIES) {
      const ratio = contrast(paletteFor(category, saturationFor(4)).base, palestSheet);
      expect(ratio, `${category} disappears when it fades`).toBeGreaterThan(2.2);
    }
  });

  it("reaches exactly forty palettes and no more", () => {
    const keys = new Set<string>();
    for (const category of CATEGORIES) {
      for (let seasons = 0; seasons < 40; seasons++) {
        keys.add(paletteFor(category, saturationFor(seasons)).key);
      }
    }
    expect(keys.size).toBe(CATEGORIES.length * 5);
  });

  it("hands back the same palette object for the same paper and level", () => {
    // Same reason: a new object per call would be a new tile per call if the key
    // were ever derived from identity rather than value.
    expect(paletteFor("humanity", 0.65)).toBe(paletteFor("humanity", 0.65));
    expect(paletteFor("humanity", 0.65)).not.toBe(paletteFor("humanity", 0.5));
  });
});
