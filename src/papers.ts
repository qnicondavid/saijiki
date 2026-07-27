// The paper stock. Eight dyed papers, one per saijiki category.
//
// Colour comes from the category; geometry comes from the id. These are the
// only two inputs a butterfly's look has, and they are deliberately separate:
// re-filing a kigo under a different category must recolour the creature
// without moving a single cut. See "The seed rule" in CLAUDE.md.
//
// The palette is warm and muted on purpose. These are dyed washi laid on a
// cream sheet, not ink on white — anything saturated enough to shout would
// break the diorama's quiet and, in eight-at-once, look like a toy. No red in
// the warning sense: `humanity` is persimmon, a dye, and it never signifies
// anything.
//
// Muted is not the same as absent. `muki` is undyed stock and the temptation is
// to render that as *pale*, but pale on a cream sheet is invisible: it was the
// lightest of the eight by a wide margin and shared the sheet's own hue, so it
// read as a smudge rather than as paper. Undyed reads instead as **low chroma**
// — a linen greige, darker than the sheet and cooler than it, still obviously
// the same family as the other seven. papers.test.ts pins the floor so this
// cannot quietly regress.

export type Category =
  | "season"
  | "heavens"
  | "earth"
  | "humanity"
  | "observances"
  | "animals"
  | "plants"
  | "muki";

export const CATEGORIES: readonly Category[] = [
  "season",
  "heavens",
  "earth",
  "humanity",
  "observances",
  "animals",
  "plants",
  "muki",
];

// One hex per category — the front face of the sheet. Everything else (cut
// edge, crease shadow, body) is derived, so tuning is a single colour per row.
export const CATEGORY_PAPERS: Record<Category, string> = {
  season: "#6f9084", // 若竹 — young bamboo, the season itself
  heavens: "#7d95ab", // 甕覗 — the palest indigo, sky and weather
  earth: "#a67c4e", // 黄土 — ochre, mountains and fields and rivers
  humanity: "#c06a52", // 柿 — persimmon, the colour of daily life
  observances: "#8d6480", // 古代紫 — old purple, festivals and rites
  animals: "#8a6b58", // 煤竹 — sooted bamboo, a quiet creature brown
  plants: "#8b9159", // 苔 — moss, growing things
  muki: "#8e8b7a", // 灰汁 — lye-washed flax, for what has no season
};

export interface Palette {
  // cache key for the render tile — palettes are values, not identities
  key: string;
  base: [number, number, number]; // the dyed face
  lit: [number, number, number]; // the cut edge catching the light: paper core, pale
  dark: [number, number, number]; // the shadowed cut edge and the fold's dark side
  body: [number, number, number]; // the folded body strip, a shade deeper
  /** 1 is full colour. See `paletteFor`. */
  saturation: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function mix(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

const PAPER_CORE: [number, number, number] = [252, 246, 233]; // undyed pulp inside the sheet
const INK_SHADOW: [number, number, number] = [44, 33, 24];

// Rec. 601 luminance, which is the grey a colour reads as. Pulling a colour
// toward its own grey removes chroma and leaves lightness alone — one dye
// draining out of the paper, rather than the paper going darker or the picture
// going flat.
function luminance(c: [number, number, number]): number {
  return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
}

function drain(c: [number, number, number], saturation: number): [number, number, number] {
  if (saturation >= 1) return c;
  const grey: [number, number, number] = [luminance(c), luminance(c), luminance(c)];
  return mix(grey, c, saturation);
}

/**
 * The paper a kigo is cut from, with `saturation` of its dye left in it.
 *
 * Dye soaks the surface but not the middle: a fresh scissor cut shows a pale
 * fibrous core, which is what makes cut paper read as *thick* rather than as a
 * flat vector shape. That edge is what `lit` is for.
 *
 * Fading is applied to the *base* and the rest of the palette is then derived
 * from it as usual, so a bleached sheet's cut edge and crease shadow stay in the
 * relationship to its face that they had when it was new. Draining each of the
 * four separately would let a faded creature's edges drift out of agreement with
 * its own surface.
 *
 * This is chroma only. CLAUDE.md's fade table is a saturation table, and the
 * crisp-and-pale versus soft-and-worn *texture* treatment that goes with it is a
 * later step — doing half of it here by lightening as well would make that step
 * a redesign instead of an addition.
 *
 * The key is what the tile cache is keyed on, so the number of distinct
 * palettes is the number of distinct keys. `saturation` only ever arrives from
 * `saturationFor`, which has five values, so eight papers make forty palettes
 * and no more — papers.test.ts pins that, because a caller passing a continuous
 * saturation would multiply the tile cache by however many butterflies there
 * are and turn the fade into a performance bug.
 */
export function paletteFor(category: Category, saturation = 1): Palette {
  const key = `${category}@${Math.round(saturation * 100)}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const base = drain(hexToRgb(CATEGORY_PAPERS[category]), saturation);
  const palette: Palette = {
    key,
    base,
    lit: mix(base, PAPER_CORE, 0.62),
    dark: mix(base, INK_SHADOW, 0.5),
    body: mix(base, INK_SHADOW, 0.3),
    saturation,
  };
  cache.set(key, palette);
  return palette;
}

const cache = new Map<string, Palette>();
