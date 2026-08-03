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
//
// --- and the two things time does to it ------------------------------------
//
// A palette is a paper plus what has happened to it, and two different things
// have happened. They are separate dimensions on purpose:
//
//   · `saturation` is *recency* — how long since the kigo was last known to be
//     true. CLAUDE.md's five-step table. It says how much dye is left.
//   · `wear` is *frequency* — how many times it has been picked up, ever. It
//     says nothing about colour and everything about the edges.
//
// A butterfly can be faint and pristine (begun two years ago, touched once,
// never since) or faint and deeply worn (begun two years ago, held twenty
// times, not lately). Those are different lives and they should not look alike,
// which one channel cannot say and two can.

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

export type RGB = [number, number, number];

/**
 * A piece of paper: its face, and everything derived from it.
 *
 * Dye soaks the surface but not the middle: a fresh scissor cut shows a pale
 * fibrous core, which is what makes cut paper read as *thick* rather than as a
 * flat vector shape. That edge is what `lit` is for.
 */
export interface Stock {
  base: RGB; // the dyed face
  lit: RGB; // the cut edge catching the light: paper core, pale
  dark: RGB; // the shadowed cut edge and the fold's dark side
  body: RGB; // a shade deeper — the folded body strip, the back of a fold
}

export interface Palette extends Stock {
  // cache key for the render tile — palettes are values, not identities
  key: string;
  /**
   * The key for the dyed swatch, which is the *face* and nothing else.
   *
   * Deliberately shorter than `key`: the swatch is a field of the base colour
   * with grain in it, and wear does not touch the base colour. Keying the
   * swatch on the whole palette instead would mint four identical swatches per
   * paper per fade level — the exact "continuous cache dimension" that wear is
   * quantised to avoid, reintroduced one layer down.
   */
  dyeKey: string;
  /** 1 is full colour. See `paletteFor`. */
  saturation: number;
  /** 0 is a fresh scissor cut. See `WEAR_LEVELS`. */
  wear: number;
}

/** `rgba(...)`, because every module that draws paper needs this one line. */
export function rgba(c: RGB, a = 1): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

const PAPER_CORE: RGB = [252, 246, 233]; // undyed pulp inside the sheet
const INK_SHADOW: RGB = [44, 33, 24];

// The sheet a butterfly is laid on, as a colour to bleach *toward*. A copy of
// PAPER.aerial rather than an import: paper.ts is the diorama and this is the
// stock it is cut from, and a cycle between them would put the whole renderer
// into the palette module's dependency graph. The four sheet variants differ by
// a handful of units, so nothing is lost by holding one number here.
const SHEET: RGB = [238, 228, 211];

// Rec. 601 luminance, which is the grey a colour reads as. Pulling a colour
// toward its own grey removes chroma and leaves lightness alone — one dye
// draining out of the paper, rather than the paper going darker or the picture
// going flat.
function luminance(c: RGB): number {
  return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
}

// The sheet's own hue, as an offset from neutral. This is what "warm" means
// everywhere below: not a hue rotation, but the cream the diorama is already
// made of, laid over a grey.
const SHEET_LUM = luminance(SHEET);
const SHEET_TINT: RGB = [
  SHEET[0] / SHEET_LUM - 1,
  SHEET[1] / SHEET_LUM - 1,
  SHEET[2] / SHEET_LUM - 1,
];

/**
 * Cream at lightness `lum`, carrying the tint the paper had at `at`.
 *
 * The two arguments are the fix for a real bug rather than a nicety. The
 * obvious version scales the sheet's whole colour to the lightness asked for —
 * but chroma scales with it, so a *lighter* cream is a more colourful one, and
 * a paper bleached further therefore ends up with more chroma in its target
 * than one bleached less. On the seven dyed papers that is invisible, because
 * they start far more saturated than any cream. On `muki`, which is undyed and
 * barely coloured at all, it inverts the fade: chroma went 20 → 19 → 20 across
 * the levels, and "fading only ever drains" quietly stopped being true.
 *
 * So the tint is fixed at the paper's own original lightness and only the
 * lightness moves. And it is capped at the paper's own chroma, because nothing
 * should ever bleach *toward* more colour than it started with — which is the
 * same sentence the fade table is written to say.
 */
function warm(lum: number, at: number, cap: number): RGB {
  const tint: RGB = [SHEET_TINT[0] * at, SHEET_TINT[1] * at, SHEET_TINT[2] * at];
  const c = Math.max(...tint) - Math.min(...tint);
  const k = c > cap ? cap / c : 1;
  return [lum + tint[0] * k, lum + tint[1] * k, lum + tint[2] * k];
}

// --- the three fade treatments ----------------------------------------------
//
// CLAUDE.md's fade table is labelled *Saturation*, and the prose beside it says
// *sun-bleached*. Those are not the same picture, and the difference is the
// whole argument: grey reads as drained, pale reads as aged, and two rounds
// went into making sure neglect never reads as death.
//
// So all three are here, `f` cycles them, and the F9 overlay names the one on
// screen. One will be baked in and the other two deleted.
//
// A treatment answers with two colours rather than one. `face` is the dyed
// surface. `folds` is what the cut edge, the crease and the body strip are
// derived from — usually the same colour, but not necessarily, and `sheltered`
// is the reason the distinction exists at all.

interface Bleached {
  face: RGB;
  folds: RGB;
}

export interface FadeTreatment {
  /** for the F9 overlay */
  name: string;
  /** key fragment. Empty for the default, so its keys read as they always have. */
  tag: string;
  apply(base: RGB, saturation: number): Bleached;
}

/** Toward its own luminance grey: chroma out, lightness untouched. */
function toGrey(c: RGB, saturation: number): RGB {
  if (saturation >= 1) return c;
  const l = luminance(c);
  return mix([l, l, l], c, saturation);
}

/**
 * Toward the sheet's own cream, lifted by `lift` of the way there.
 *
 * What actually happens to dyed paper left in a window: the dye photodegrades
 * and the pulp underneath shows through, so the sheet's own colour comes up as
 * the dye goes down. It lightens and it warms, and it does both at once because
 * they are the same event.
 *
 * `lift` is well under one on purpose. Bleaching the whole way to the sheet at
 * the hard floor puts persimmon at about 2.05:1 against the palest variant,
 * under the 2.2 legibility floor papers.test.ts pins — which is "nothing dies"
 * failing by a different route than grey. The dye is allowed to leave; the
 * paper is not allowed to.
 */
function toSheet(c: RGB, saturation: number, lift: number): RGB {
  if (saturation >= 1) return c;
  const l = luminance(c);
  const chroma = Math.max(...c) - Math.min(...c);
  return mix(warm(l + (SHEET_LUM - l) * lift * (1 - saturation), l, chroma), c, saturation);
}

export const FADE_TREATMENTS: readonly FadeTreatment[] = [
  {
    // What shipped with the fading step, and a literal reading of the table.
    // Every colour walks to its own grey at constant lightness, so a bleached
    // creature is exactly as dark as it ever was and the depth channel — which
    // *does* move lightness, toward the sheet — stays distinguishable from it.
    //
    // The complaint against it: eight papers all walk to greys of eight
    // different lightnesses, and at the floor the category stops being legible.
    // A shelf of old kigo is a shelf of grey.
    name: "chroma",
    tag: "",
    apply: (c, s) => {
      const drained = toGrey(c, s);
      return { face: drained, folds: drained };
    },
  },
  {
    // Sun-bleached, as the prose asks for. Desaturated, lightened and warmed
    // toward the sheet in one move, because in real paper they are one move.
    //
    // The complaint against it: everything converges on the same warm pale, and
    // the closer a butterfly gets to the sheet's own colour the less of it
    // there is. It is the friendlier picture and the riskier one.
    name: "bleach",
    tag: "b:",
    apply: (c, s) => {
      const bleached = toSheet(c, s, BLEACH_LIFT);
      return { face: bleached, folds: bleached };
    },
  },
  {
    // The third, and the one I would keep.
    //
    // Paper does not bleach evenly. What is folded, creased or turned under is
    // sheltered from the light, and it holds its dye long after the exposed
    // face has given up — open a fifty-year-old folded map and the colour is
    // still bright in the valleys. So: the face bleaches further than either of
    // the two above, and the cut edge, the crease and the body strip keep most
    // of what they had.
    //
    // Which answers both complaints at once. The creature reads as unmistakably
    // aged, because the surface — nearly all of what the eye sees — is paler
    // and warmer than `bleach` makes it. And it does not lose its category,
    // because the dye is still there in every cut and along the fold, exactly
    // where the eye goes to read an edge. Nothing has died; it has receded into
    // the folds.
    //
    // It also happens to make the app's own argument for it. This is the file
    // that says a cut edge shows the pale core the dye never reached; the same
    // sentence read backwards says the fold is where the dye is safest.
    name: "sheltered",
    tag: "s:",
    apply: (c, s) => ({
      face: toSheet(c, s, SHELTER.faceLift),
      folds: toSheet(c, s + (1 - s) * SHELTER.keep, SHELTER.foldLift),
    }),
  },
];

const BLEACH_LIFT = 0.35;

const SHELTER = {
  faceLift: 0.5, // the exposed surface goes further than `bleach` takes it
  keep: 0.55, // and the folds hold back this much of what the face lost
  foldLift: 0.12, // they lighten a little too — they are the same sheet
};

let active = 0;

export function fadeTreatment(): FadeTreatment {
  return FADE_TREATMENTS[active];
}

export function fadeTreatmentName(): string {
  return FADE_TREATMENTS[active].name;
}

/**
 * dev: the next treatment. Clears the palette cache, because every palette in
 * it was made by the old one.
 *
 * The *tile* cache is the caller's problem and has to go too — every tile in it
 * was rendered against a palette that no longer exists. dev-harness.ts does
 * that, and re-applies the swarm so the flyers pick up new palette objects.
 */
export function cycleFadeTreatment(): string {
  active = (active + 1) % FADE_TREATMENTS.length;
  cache.clear();
  return FADE_TREATMENTS[active].name;
}

// --- wear --------------------------------------------------------------------

/**
 * How many steps of handling a piece of paper can show.
 *
 * Four, and quantised, for the same reason the fade has five: `wear` is part of
 * the palette key and the palette key is part of the tile cache key. A
 * continuous wear — the raw touch count — would mint a sprite sheet per
 * butterfly and turn a texture detail into a performance bug. See the note on
 * `paletteFor`.
 *
 * The thresholds are in saijiki.ts, where the touches are.
 */
export const WEAR_LEVELS = 4;

function stockOf(base: RGB, folds: RGB = base): Stock {
  return {
    base,
    lit: mix(folds, PAPER_CORE, 0.62),
    dark: mix(folds, INK_SHADOW, 0.5),
    body: mix(folds, INK_SHADOW, 0.3),
  };
}

/**
 * The same treatment, for a piece of paper that is not a kigo.
 *
 * The scissors and the slip are made of paper too, and they have to be lit and
 * cut the same way or the diorama comes apart. They have no category and no
 * fade, so they take a face colour directly — but the derivation is this one,
 * because "how a cut edge follows from a face" is a fact about paper rather
 * than about kigo.
 */
export function paperStock(hex: string): Stock {
  return stockOf(hexToRgb(hex));
}

/**
 * The paper a kigo is cut from: `saturation` of its dye left in it, and `wear`
 * steps of handling on its edges.
 *
 * Fading is applied to the *base* and the rest of the palette is then derived
 * from it as usual, so a bleached sheet's cut edge and crease shadow stay in the
 * relationship to its face that they had when it was new. Draining each of the
 * four separately would let a faded creature's edges drift out of agreement with
 * its own surface. `sheltered` is the deliberate exception, and it moves the two
 * apart by a *stated* amount rather than by accident.
 *
 * Wear does not appear here at all: it changes no colour. It rides in the key
 * so the renderer can read it off the palette, which is the only thing every
 * tile already carries. See `strokeThickness` and `paintCrease`.
 *
 * The key is what the tile cache is keyed on, so the number of distinct
 * palettes is the number of distinct keys. `saturation` only ever arrives from
 * `saturationFor`, which has five values, and `wear` from `wearOf`, which has
 * four — so eight papers make a hundred and sixty palettes and no more.
 * papers.test.ts pins that, because a caller passing a continuous value for
 * either would multiply the tile cache by however many butterflies there are.
 *
 * A hundred and sixty is not a hundred and sixty *tiles*, and that is the whole
 * reason wear is affordable: a butterfly has exactly one palette at a time, so
 * the tile working set is one sprite sheet per creature whatever the palette
 * space looks like. What a palette count does bound is the dyed swatches — and
 * those are keyed on `dyeKey`, which wear is not in.
 */
export function paletteFor(category: Category, saturation = 1, wear = 0): Palette {
  const t = FADE_TREATMENTS[active];
  const w = Math.max(0, Math.min(WEAR_LEVELS - 1, Math.round(wear)));
  const dyeKey = `${t.tag}${category}@${Math.round(saturation * 100)}`;
  const key = `${dyeKey}~${w}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const { face, folds } = t.apply(hexToRgb(CATEGORY_PAPERS[category]), saturation);
  const palette: Palette = { key, dyeKey, ...stockOf(face, folds), saturation, wear: w };
  cache.set(key, palette);
  return palette;
}

const cache = new Map<string, Palette>();
