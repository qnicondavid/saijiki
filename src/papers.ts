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
  muki: "#b0a48c", // 生成り — undyed flax, for what has no season
};

export interface Palette {
  // cache key for the render tile — palettes are values, not identities
  key: string;
  base: [number, number, number]; // the dyed face
  lit: [number, number, number]; // the cut edge catching the light: paper core, pale
  dark: [number, number, number]; // the shadowed cut edge and the fold's dark side
  body: [number, number, number]; // the folded body strip, a shade deeper
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

// Dye soaks the surface but not the middle: a fresh scissor cut shows a pale
// fibrous core, which is what makes cut paper read as *thick* rather than as a
// flat vector shape. That edge is what `lit` is for.
export function paletteFor(category: Category): Palette {
  const cached = cache.get(category);
  if (cached) return cached;
  const base = hexToRgb(CATEGORY_PAPERS[category]);
  const palette: Palette = {
    key: category,
    base,
    lit: mix(base, PAPER_CORE, 0.62),
    dark: mix(base, INK_SHADOW, 0.5),
    body: mix(base, INK_SHADOW, 0.3),
  };
  cache.set(category, palette);
  return palette;
}

const cache = new Map<Category, Palette>();
