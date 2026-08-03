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

import { afterEach, describe, expect, it } from "vitest";
import {
  CATEGORIES,
  CATEGORY_PAPERS,
  FADE_TREATMENTS,
  WEAR_LEVELS,
  cycleFadeTreatment,
  fadeTreatmentName,
  paletteFor,
} from "./papers";
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
const chroma = (c: RGB) => Math.max(...c) - Math.min(...c);

// The active treatment is module state, so every test that moves it puts it
// back. `cycleFadeTreatment` is the only way in and it only goes forwards.
function withTreatment(name: string, body: () => void): void {
  const from = fadeTreatmentName();
  while (fadeTreatmentName() !== name) cycleFadeTreatment();
  try {
    body();
  } finally {
    while (fadeTreatmentName() !== from) cycleFadeTreatment();
  }
}

afterEach(() => {
  while (fadeTreatmentName() !== FADE_TREATMENTS[0].name) cycleFadeTreatment();
});

// --- what every treatment has to do -----------------------------------------
//
// Three readings of one table are on offer and one will be baked in, so the
// things that must be true of *any* of them are pinned against all three. What
// each does differently is pinned separately below — that is the choice, and it
// is a choice about what looks right rather than about what is correct.

describe.each(FADE_TREATMENTS.map((t) => t.name))("fading, treatment %s", (name) => {
  it("only ever drains chroma, never the other way", () => {
    withTreatment(name, () => {
      for (const category of CATEGORIES) {
        let previous = Infinity;
        for (const s of FADE_LEVELS) {
          const now = chroma(paletteFor(category, s).base);
          expect(now, `${category} at ${s}`).toBeLessThanOrEqual(previous);
          previous = now;
        }
      }
    });
  });

  it("keeps the cut edge paler than the face however faded the paper is", () => {
    withTreatment(name, () => {
      for (const category of CATEGORIES) {
        for (const s of FADE_LEVELS) {
          const p = paletteFor(category, s);
          expect(luminance(p.lit), `${category} at ${s}`).toBeGreaterThan(luminance(p.base));
          expect(luminance(p.dark), `${category} at ${s}`).toBeLessThan(luminance(p.base));
        }
      }
    });
  });

  it("holds every category above the legibility floor even on the hard floor", () => {
    // "Nothing dies." A butterfly left alone for four seasons has to still be a
    // piece of coloured paper on a cream sheet, not a smudge — and that is the
    // floor the two bleaching treatments can fail against, because they are
    // walking *toward* the sheet rather than sideways from it. A lift of much
    // over a third puts persimmon under this.
    withTreatment(name, () => {
      for (const category of CATEGORIES) {
        const ratio = contrast(paletteFor(category, saturationFor(4)).base, palestSheet);
        expect(ratio, `${category} disappears when it fades`).toBeGreaterThan(2.2);
      }
    });
  });

  it("never lightens the paper past the sheet it is lying on", () => {
    // The other end of the same worry: a bleach that overshoots stops being
    // paper on a sheet and becomes a hole in it.
    withTreatment(name, () => {
      for (const category of CATEGORIES) {
        for (const s of FADE_LEVELS) {
          expect(luminance(paletteFor(category, s).base), `${category} at ${s}`).toBeLessThan(
            luminance(palestSheet),
          );
        }
      }
    });
  });
});

// --- and what each of them does differently ---------------------------------

describe("the three readings of the fade table", () => {
  const persimmon = () => ({
    fresh: paletteFor("humanity", 1),
    floor: paletteFor("humanity", saturationFor(4)),
  });

  it("chroma: takes the dye out and leaves the lightness alone", () => {
    withTreatment("chroma", () => {
      for (const category of CATEGORIES) {
        if (category === "muki") continue; // already near-grey; the margins are too fine to pin
        const fresh = paletteFor(category, 1);
        const faded = paletteFor(category, saturationFor(4));
        expect(chroma(faded.base), category).toBeLessThan(chroma(fresh.base));
        // within a rounding step or two: a chroma change, not a fade to white
        expect(Math.abs(luminance(faded.base) - luminance(fresh.base))).toBeLessThan(0.02);
      }
    });
  });

  it("bleach: lightens as well, and warms as it does", () => {
    withTreatment("bleach", () => {
      const { fresh, floor } = persimmon();
      expect(luminance(floor.base)).toBeGreaterThan(luminance(fresh.base) * 1.15);
      // warmer means the red-to-blue gap has not fallen as fast as the chroma:
      // the dye is leaving but what is underneath is cream, not grey
      const warmth = (c: RGB) => c[0] - c[2];
      withTreatment("chroma", () => {
        const grey = paletteFor("humanity", saturationFor(4));
        // compared at the same fade level, against the treatment that goes grey
        expect(warmth(floor.base)).toBeGreaterThan(warmth(grey.base));
        expect(luminance(floor.base)).toBeGreaterThan(luminance(grey.base));
      });
    });
  });

  it("sheltered: the face gives up its dye and the folds keep theirs", () => {
    // The whole idea, and the only one of the three where `lit`, `dark` and
    // `body` are not derived from the same colour as the face. What is folded
    // is sheltered from the light, so the category stays legible in the cuts
    // and along the crease long after the surface has gone pale.
    //
    // Stated against `bleach` rather than against the face, because `dark` and
    // `body` are the face *darkened* and darkening shrinks chroma on its own —
    // "the fold has more colour in it than the surface" is true to the eye and
    // false to the arithmetic. Same derivation, same fade level, two
    // treatments: that comparison says exactly the thing and nothing else.
    //
    // And measured as *distance from the fresh paper* rather than as chroma,
    // because chroma cannot tell a green that is still green from one that has
    // bleached to a warm grey of the same faint intensity. `season` fails that
    // way and looks fine: mixing a green toward cream crosses neutral and comes
    // out the other side warm, so it reads as a different paper while measuring
    // as the same amount of colour. "Has moved less far from what it was" is
    // the claim being made, so it is the thing to measure.
    const floor = saturationFor(4);
    const dyed = CATEGORIES.filter((c) => c !== "muki"); // undyed: nothing to shelter
    const apart = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const fresh: Record<string, RGB> = {};
    const mine: Record<string, RGB> = {};
    for (const c of dyed) fresh[c] = paletteFor(c, 1).dark; // the same for all three
    withTreatment("sheltered", () => {
      for (const c of dyed) mine[c] = paletteFor(c, floor).dark;
      mine.__face = paletteFor("humanity", floor).base;
    });
    withTreatment("bleach", () => {
      for (const c of dyed) {
        expect(apart(mine[c], fresh[c]), `${c} lost its folds too`).toBeLessThan(
          apart(paletteFor(c, floor).dark, fresh[c]),
        );
      }
      // and the face goes paler than `bleach` takes it, which is what buys the
      // folds their dye: the same fade, spent unevenly
      expect(luminance(mine.__face)).toBeGreaterThan(
        luminance(paletteFor("humanity", floor).base),
      );
    });
  });

  it("leaves a fresh paper alone, whichever treatment is active", () => {
    // At full colour there is nothing to fade, so all three have to agree —
    // which is also what keeps the icon, the slip and the scissors identical
    // whichever of the three is eventually baked in.
    const fresh = FADE_TREATMENTS.map((t) => {
      let base: RGB = [0, 0, 0];
      withTreatment(t.name, () => {
        base = paletteFor("humanity", 1).base;
      });
      return base.join(",");
    });
    expect(new Set(fresh).size).toBe(1);
  });
});

// --- wear -------------------------------------------------------------------

describe("wear", () => {
  it("changes no colour at all", () => {
    // It is entirely an edge treatment — see BUTTERFLY.render.wear. If it ever
    // starts moving a colour it has become a second fade channel, and the two
    // would then be saying the same thing in the same place.
    for (const category of CATEGORIES) {
      for (const s of FADE_LEVELS) {
        const fresh = paletteFor(category, s, 0);
        for (let w = 1; w < WEAR_LEVELS; w++) {
          const worn = paletteFor(category, s, w);
          expect([worn.base, worn.lit, worn.dark, worn.body], `${category} at ${s}/${w}`).toEqual([
            fresh.base,
            fresh.lit,
            fresh.dark,
            fresh.body,
          ]);
        }
      }
    }
  });

  it("reaches a hundred and sixty palettes and no more", () => {
    // Five fade levels times four wear levels times eight papers. The point is
    // that both dimensions are *quantised*: a caller passing a raw touch count
    // would mint a palette per butterfly, and since the palette key is part of
    // the tile cache key that is a sprite sheet per butterfly.
    const keys = new Set<string>();
    for (const category of CATEGORIES) {
      for (let seasons = 0; seasons < 40; seasons++) {
        for (let touches = 0; touches < 40; touches++) {
          keys.add(paletteFor(category, saturationFor(seasons), Math.min(touches, 3)).key);
        }
      }
    }
    expect(keys.size).toBe(CATEGORIES.length * 5 * WEAR_LEVELS);
  });

  it("stays out of the dyed swatch's key, which is the face and nothing else", () => {
    // The cost that would otherwise hide one layer down. A swatch is a base
    // colour with grain in it and wear does not touch a base colour, so four
    // wear levels must not mean four byte-identical swatches per paper.
    const swatches = new Set<string>();
    const palettes = new Set<string>();
    for (const category of CATEGORIES) {
      for (const s of FADE_LEVELS) {
        for (let w = 0; w < WEAR_LEVELS; w++) {
          const p = paletteFor(category, s, w);
          palettes.add(p.key);
          swatches.add(p.dyeKey);
        }
      }
    }
    expect(palettes.size).toBe(CATEGORIES.length * FADE_LEVELS.length * WEAR_LEVELS);
    expect(swatches.size).toBe(CATEGORIES.length * FADE_LEVELS.length);
  });

  it("clamps rather than trusting its caller", () => {
    expect(paletteFor("humanity", 1, 99).wear).toBe(WEAR_LEVELS - 1);
    expect(paletteFor("humanity", 1, -3).wear).toBe(0);
    // and a fraction lands on a level rather than making one of its own
    expect(paletteFor("humanity", 1, 1.4).key).toBe(paletteFor("humanity", 1, 1).key);
  });

  it("hands back the same palette object for the same paper, level and wear", () => {
    // A new object per call would be a new tile per call if the key were ever
    // derived from identity rather than value.
    expect(paletteFor("humanity", 0.65, 2)).toBe(paletteFor("humanity", 0.65, 2));
    expect(paletteFor("humanity", 0.65, 2)).not.toBe(paletteFor("humanity", 0.5, 2));
    expect(paletteFor("humanity", 0.65, 2)).not.toBe(paletteFor("humanity", 0.65, 1));
  });
});
