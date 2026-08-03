// The butterfly's genotype: id in, plain data out.
//
// deriveButterfly is pure. No canvas, no DOM, no clock, no randomness that
// isn't seeded off the id. It returns a ButterflySpec — every outline, every
// cut, every hand-cut wobble already resolved into coordinates — and that spec
// is the *only* thing the renderer is allowed to see.
//
// This split is load-bearing three times over:
//   · The seed rule (CLAUDE.md) becomes testable as plain data. Fixing a typo
//     in an entry cannot possibly change the creature, because the text was
//     never an input.
//   · Step 7 can animate a spec — interpolate it, tilt it, open its wings —
//     without re-deriving anything.
//   · Step 16 turns the same spec into an origami fold diagram. It needs the
//     outlines and the fold, not a bitmap.
//
// Coordinates are in *unit space*: the fold runs down x = 0, and the wingspan
// spans x ∈ [-0.5, 0.5]. The renderer's `scale` argument is therefore the
// wingspan in css px, which is the number worth reasoning about when a
// butterfly sits on a far depth plane.

import { fbm, hash, hashString, stream } from "./noise";

// --- tunables -------------------------------------------------------------

const range = (a: number, b: number): [number, number] => [a, b];

export const BUTTERFLY = {
  // bump when the geometry rules change in a way that should regenerate
  // everything; specs carry it so a cache can tell old art from new
  version: 1,

  // Gene ranges. Narrow enough that twenty ids read as one family, wide enough
  // that no two read as the same creature. If they all start to look alike,
  // widen here before reaching for new machinery.
  gene: {
    // forewing — the upper, larger panel
    foreRootTop: range(0.1, 0.17), // how far up the fold it attaches
    foreTipX: range(0.43, 0.5),
    foreTipY: range(0.21, 0.36), // above centre
    foreLeadBow: range(-0.02, 0.1), // leading-edge bulge, fraction of chord
    foreOuterX: range(0.28, 0.4),
    foreOuterY: range(-0.05, 0.1),
    foreOuterBow: range(0.02, 0.14),
    foreTrailBow: range(-0.12, 0.02),
    foreRootBot: range(0.0, 0.03),
    foreNotches: range(0, 2), // shallow scissor bites out of the outer edge
    foreNotchDepth: range(0.03, 0.07),

    // hindwing — lower, rounder, tucked under the forewing at the fold
    hindOutX: range(0.23, 0.34),
    hindOutY: range(0.05, 0.16),
    hindLeadBow: range(0.0, 0.1),
    hindTailX: range(0.07, 0.24),
    hindTailY: range(0.2, 0.38),
    hindTrailBow: range(0.0, 0.06),
    hindRootBot: range(0.13, 0.25),
    hindScallops: range(2, 4), // wycinanki lobes along the trailing edge
    hindScallopDepth: range(0.04, 0.12),

    // body and antennae
    bodyWidth: range(0.028, 0.044),
    bodySegments: range(4, 7),
    antennaLen: range(0.11, 0.18),
    antennaSpread: range(0.34, 0.7),
    antennaCurl: range(0.1, 0.45),

    // whole-creature proportion
    yScale: range(0.86, 1.14),
  },

  // Papel picado and wycinanki: the pattern *is* absence. Every one of these
  // is a hole, never a painted marking.
  cut: {
    margin: 0.02, // minimum web of paper between a cut and any edge
    gap: 0.016, // minimum web between two cuts
    wobble: 0.11, // hand-punched irregularity, fraction of radius
    eyeletR: range(0.016, 0.026),
    eyeletSpacing: range(0.065, 0.1),
    eyeletInset: range(0.045, 0.066),
    chainR: range(0.038, 0.062),
    eyespotR: range(0.055, 0.09),
    fanCount: range(3, 5),
    fanLength: range(0.11, 0.18),
    bandCount: range(3, 6),
  },

  // The scissor never runs true. Low-frequency wander plus a fine tooth.
  scissor: {
    wobble: 0.009,
    wobbleScale: 0.11,
    tooth: 0.0026,
    toothScale: 0.021,
    steps: 13, // samples per outline edge
    foldSteps: 4, // the fold is straight; it needs almost none
  },

  // The two halves are cut through a folded sheet, so they are near-mirrored —
  // but the paper shifts under the blade. Never exactly.
  asymmetry: {
    scaleX: 0.05,
    scaleY: 0.045,
    rotate: 0.038, // radians
    shiftY: 0.013,
  },

  render: {
    // Fold shading. A panel is shaded by the angle it is actually held at
    // (see WingPose in butterfly-render), so these describe how hard that
    // reads, not which way it leans — the lean comes from the pose.
    //
    // The gamma is doing real work. A panel resting a few degrees off the
    // picture plane and a panel stood on edge at the top of a wingbeat differ
    // by about 7x in lambert terms; one linear gain either flattens the resting
    // pose to nothing or turns the beating one to soot. Compressing the
    // response serves both.
    foldContrast: 0.55, // gain on the lit/shadow wash across the fold
    foldGamma: 0.6, // compresses the range between a still wing and a beating one
    foldMaxAlpha: 0.62, // paper is never this dark; ambient light exists
    lightZ: 0.85, // how frontal the key light is, for the panel's lambert term
    panelSplit: 0.045, // hindwing sits behind, so it sits darker
    creaseAlpha: 0.45,
    // The bevel is a fraction of the wingspan, clamped: a fixed 1px rim looks
    // right at 200px and welds every punched hole shut at 60px.
    edgeWidthFactor: 0.006,
    edgeWidthPx: range(0.34, 1.1),
    edgeOffsetFactor: 0.004,
    edgeOffsetPx: range(0.25, 0.8),
    litAlpha: 0.55,
    darkAlpha: 0.42,

    // Handling, per step of `palette.wear`. The second channel: colour says how
    // long since a kigo was last true, this says how often it has been picked
    // up, and CLAUDE.md wants both — untouched crisp but pale, touched soft but
    // vivid, worn at the folds.
    //
    // All of it lives on the *edges*, which is where paper actually shows its
    // handling. Nothing here touches the face, the dye or the geometry: the
    // spec is the id's and a creature must not change shape because it was
    // loved. What changes is how sharply it was cut, which was never in the
    // spec to begin with.
    wear: {
      // A fresh scissor cut has a narrow, high-contrast bevel. Handling widens
      // it and takes the contrast out — the dye rubs off the ridge of the cut
      // and the pale core underneath spreads.
      edgeWiden: 0.3,
      edgeFade: 0.17,
      // And a second, wider, much fainter pass over the same edge: the fibres
      // that have lifted away from the cut. This is what reads as *fur* rather
      // than as a thicker line.
      //
      // It started three times this wide and had to come back a long way. A
      // wing carries thirty punched holes, every one of them an edge, so a halo
      // generous enough to look right on the silhouette meets itself in the
      // middle of the panel and the whole creature goes pale — which is the
      // *fade* channel's job, and two channels saying the same thing is one
      // channel and a bug. Wear has to stay on the edges to stay legible as
      // wear.
      fur: 0.075,
      furWiden: 0.9,
      // The fold. A crease worked over and over cracks along its ridge and
      // shows the white core, so the pale side of it strengthens while the dark
      // side softens — the opposite of what a *cut* does when it wears, and the
      // reason a much-handled butterfly reads as folded rather than as blurred.
      creaseWiden: 0.34,
      creaseCrack: 0.22,
      // The silhouette itself, pulled in. A corner held a hundred times is not
      // a corner any more, and no amount of shading will claim otherwise — the
      // outline has to give. See `erodeLayer`. Holes are pulled in from their
      // own side by the same amount, because a punched hole is handled from
      // both faces.
      //
      // A fraction of the *wingspan*, deliberately not of the bevel width. The
      // bevel is clamped to a third of a pixel at the bottom so that a hairline
      // still renders — but the erosion has no such floor to respect, and
      // borrowing the clamped number made a thirty-pixel butterfly lose a fifth
      // of its area where a hundred-and-seventy-pixel one lost a twentieth.
      // Rounding a corner is a fact about a shape, so it scales with the shape.
      erode: 0.003,
    },
    layerShadowAlpha: 0.22, // forewing onto hindwing
    layerShadowFactor: 0.008,
    grainScalePx: 13, // paper grain is fixed in css px, not in unit space:
    grainAmount: 9, // a small piece of the same sheet has finer-looking tooth
    reliefAmp: 40,
    reliefScalePx: 6.5,
    // Every creature is cut from one sheet, so the dyed stock is generated once
    // per paper as a swatch this many css px square and each butterfly takes its
    // own patch of it. Generating it per tile instead would mean paying for the
    // texture on all twelve wingbeat phases, which is most of the cost of a
    // sprite sheet for none of the benefit.
    dyeSwatchPx: 128,
    shadow: {
      blurFactor: 0.11, // of wingspan
      minBlur: 1.4,
      maxBlur: 9,
      offsetFactor: 0.06,
      minOffset: 0.9,
      maxOffset: 4.5,
      alpha: 0.3,
    },
  },

  // Procedural art that only reads at full size is useless. At 14px wingspan
  // most of the pattern must simply not be cut, or it turns to mush.
  lod: {
    minCutPx: 0.85, // a cut whose radius falls below this in px is never punched
    antennaeAbovePx: 26, // wingspan below which antennae are dropped
    creaseAbovePx: 15,
    edgeAbovePx: 18,
    // Handling takes the corners off, and a corner has to be a couple of pixels
    // across before there is anything to take. Sitting a little above
    // `edgeAbovePx` rather than on it, because the erosion is the one part of
    // wear that costs a scratch canvas and three extra composites, and thirteen
    // pixels of butterfly has no corner worth the trouble.
    erodeAbovePx: 22,
  },

  // Tiles, not butterflies. Every wingbeat phase of every (creature, paper,
  // wingspan) pair is its own pre-rendered tile, so forty butterflies at twelve
  // phases is already ~500 entries and the whole set is touched inside one
  // wingbeat — a cache that cannot hold all of it holds none of it. Sized with
  // room for the gallery's three bands on top, and for the tuning panel raising
  // the phase count. Watch the MB figure in the F9 overlay if this is changed.
  cacheSize: 2048,
};

// --- spec ------------------------------------------------------------------

export interface Pt {
  x: number;
  y: number;
}

export type CutKind = "hole" | "leaf";

export interface Cut {
  kind: CutKind;
  x: number; // centre, for level-of-detail and for the fold diagram's labels
  y: number;
  r: number; // nominal radius — the LOD threshold reads this
  points: Pt[]; // closed polygon, wound opposite to its panel's outline
}

export type PanelKind = "fore" | "hind";

// A panel is a flat piece of paper hinged on the fold. It carries no angle:
// how far it is held off the picture plane is a *pose*, which changes twelve
// times a wingbeat, and baking one into the spec would mean the creature's
// identity changed when it flapped. The renderer supplies the angle; the spec
// supplies the paper.
export interface WingPanel {
  side: -1 | 1; // -1 left of the fold, +1 right
  kind: PanelKind;
  outline: Pt[]; // closed polygon
  onFold: boolean[]; // parallel to outline: is this point on the fold, not a cut edge?
  cuts: Cut[];
}

export interface BodySpec {
  outline: Pt[];
  segments: number[]; // y of each abdomen crease
}

export interface AntennaSpec {
  points: Pt[]; // open polyline from the head outward
  clubR: number;
}

export interface SideAsymmetry {
  side: -1 | 1;
  scaleX: number;
  scaleY: number;
  rotate: number;
  shiftY: number;
}

export type MotifKind = "eyespot" | "fan" | "chain" | "band";

export interface MotifRecipe {
  kind: MotifKind;
  a: number;
  b: number;
  c: number;
  d: number;
}

export interface ButterflySpec {
  id: string;
  version: number;
  // everything drawn, antennae included, in unit space
  extent: { minX: number; minY: number; maxX: number; maxY: number };
  fold: { top: number; bottom: number }; // the mountain fold's run down x = 0
  panels: WingPanel[]; // hindwings first: back to front
  body: BodySpec;
  antennae: AntennaSpec[];
  asymmetry: SideAsymmetry[];
  motifs: { fore: MotifRecipe; hind: MotifRecipe; eyelets: boolean };
}

// --- small maths -----------------------------------------------------------

function pick(r: () => number, [lo, hi]: [number, number]): number {
  return lo + (hi - lo) * r();
}

function pickInt(r: () => number, [lo, hi]: [number, number]): number {
  return Math.min(hi, lo + Math.floor(r() * (hi - lo + 1)));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Coordinates are snapped so a spec is tidy to serialise, diff, and read in a
// fold diagram. Determinism does not depend on it — JS float maths is already
// reproducible — but a spec is data other people will look at.
function snap(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function pt(x: number, y: number): Pt {
  return { x: snap(x), y: snap(y) };
}

function signedArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

// Everything is filled with the nonzero rule so that overlapping panels union
// instead of cancelling. That only works if outlines and cuts wind opposite
// ways, so winding is canonical in the spec rather than assumed by the renderer.
function windPositive(poly: Pt[]): Pt[] {
  return signedArea(poly) < 0 ? poly.slice().reverse() : poly;
}

function windNegative(poly: Pt[]): Pt[] {
  return signedArea(poly) > 0 ? poly.slice().reverse() : poly;
}

function insidePolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distToBoundary(p: Pt, poly: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = distToSegment(p, poly[i], poly[(i + 1) % poly.length]);
    if (d < best) best = d;
  }
  return best;
}

function centroidOf(poly: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

// --- outline construction --------------------------------------------------

interface Anchor {
  x: number;
  y: number;
  onFold: boolean;
}

interface Edge {
  bow: number; // perpendicular bulge, as a fraction of the chord
  scallops?: number; // wycinanki lobes cut along the edge
  scallopDepth?: number;
}

// Walk anchor to anchor along bowed, optionally scalloped curves, displacing
// every sample along the outward normal by seeded noise. That displacement is
// the whole reason these read as *cut* rather than plotted: a scissor wanders
// on a slow wavelength and chatters on a fast one.
function buildOutline(
  anchors: Anchor[],
  edges: Edge[],
  seed: number,
): { outline: Pt[]; onFold: boolean[] } {
  const centre = centroidOf(anchors.map((a) => ({ x: a.x, y: a.y })));
  const outline: Pt[] = [];
  const onFold: boolean[] = [];
  const S = BUTTERFLY.scissor;

  for (let e = 0; e < anchors.length; e++) {
    const A = anchors[e];
    const B = anchors[(e + 1) % anchors.length];
    const isFold = A.onFold && B.onFold;
    const steps = isFold ? S.foldSteps : S.steps;
    const edge = edges[e];

    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const L = Math.hypot(dx, dy) || 1e-6;
    let nx = -dy / L;
    let ny = dx / L;
    // point the normal away from the panel's middle so `bow` always bulges out
    const mx = (A.x + B.x) / 2;
    const my = (A.y + B.y) / 2;
    if (nx * (mx - centre.x) + ny * (my - centre.y) < 0) {
      nx = -nx;
      ny = -ny;
    }

    const cx = mx + nx * edge.bow * L;
    const cy = my + ny * edge.bow * L;

    // emit t in (0,1]; the previous edge already emitted this edge's start
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      let px = u * u * A.x + 2 * u * t * cx + t * t * B.x;
      let py = u * u * A.y + 2 * u * t * cy + t * t * B.y;

      if (!isFold) {
        if (edge.scallops && edge.scallopDepth) {
          // lobes along the edge, notched between them; tapered at both ends so
          // the anchors themselves stay put
          const s = Math.abs(Math.sin(edge.scallops * Math.PI * t));
          const taper = Math.sin(Math.PI * t);
          const d = -edge.scallopDepth * L * (1 - s) * taper;
          px += nx * d;
          py += ny * d;
        }
        const slow = (fbm(px / S.wobbleScale, py / S.wobbleScale, seed, 2) - 0.5) * 2 * S.wobble;
        const fast =
          (fbm(px / S.toothScale, py / S.toothScale, seed + 17, 1) - 0.5) * 2 * S.tooth;
        px += nx * (slow + fast);
        py += ny * (slow + fast);
      }

      outline.push(pt(px, py));
      onFold.push(isFold);
    }
  }
  return { outline, onFold };
}

// --- cuts ------------------------------------------------------------------

// A punched hole. Never a true circle — it was made with a punch pressed by
// hand through several layers.
function holePoints(cx: number, cy: number, r: number, seed: number): Pt[] {
  const n = Math.max(9, Math.round(9 + r * 110));
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const w = 1 + (hash(i, seed, 0x51ed) - 0.5) * 2 * BUTTERFLY.cut.wobble;
    pts.push(pt(cx + Math.cos(a) * r * w, cy + Math.sin(a) * r * w));
  }
  return pts;
}

// An almond / leaf slit — the other half of the papel picado vocabulary.
function leafPoints(
  cx: number,
  cy: number,
  a: number,
  b: number,
  ang: number,
  seed: number,
): Pt[] {
  const half = 9;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const pts: Pt[] = [];
  const emit = (lx: number, ly: number, i: number) => {
    const w = 1 + (hash(i, seed, 0x27d4) - 0.5) * 2 * BUTTERFLY.cut.wobble;
    pts.push(pt(cx + (lx * ca - ly * w * sa), cy + (lx * sa + ly * w * ca)));
  };
  for (let i = 0; i <= half; i++) {
    const s = i / half;
    emit(-a + 2 * a * s, -b * Math.pow(Math.sin(Math.PI * s), 0.75), i);
  }
  for (let i = half - 1; i >= 1; i--) {
    const s = i / half;
    emit(-a + 2 * a * s, b * Math.pow(Math.sin(Math.PI * s), 0.75), i + 100);
  }
  return pts;
}

interface Placement {
  x: number;
  y: number;
  r: number;
}

// A cut only exists if the paper can survive it: a web must remain between it
// and every edge, and between it and every other cut. Shrink once, then give up
// — a hole that had to be shrunk twice was in the wrong place.
function place(
  outline: Pt[],
  taken: Placement[],
  x: number,
  y: number,
  r: number,
): number | null {
  const { margin, gap } = BUTTERFLY.cut;
  if (!insidePolygon({ x, y }, outline)) return null;
  for (const attempt of [r, r * 0.7]) {
    if (distToBoundary({ x, y }, outline) < attempt + margin) continue;
    let clash = false;
    for (const t of taken) {
      if (Math.hypot(t.x - x, t.y - y) < t.r + attempt + gap) {
        clash = true;
        break;
      }
    }
    if (!clash) return attempt;
  }
  return null;
}

// A leaf is long and thin, so fitting it as a disc of its own length rejects
// nearly every position on a wing — which is how wings ended up blank. Clear
// the paper by the *minor* axis and probe the two tips separately.
function placeLeaf(
  outline: Pt[],
  taken: Placement[],
  x: number,
  y: number,
  half: number,
  thin: number,
  ang: number,
): { half: number; thin: number } | null {
  const { margin, gap } = BUTTERFLY.cut;
  if (!insidePolygon({ x, y }, outline)) return null;
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  for (const k of [1, 0.7]) {
    const a = half * k;
    const b = thin * k;
    if (distToBoundary({ x, y }, outline) < b + margin) continue;
    const tips = [
      { x: x + dx * a, y: y + dy * a },
      { x: x - dx * a, y: y - dy * a },
    ];
    if (tips.some((t) => !insidePolygon(t, outline) || distToBoundary(t, outline) < margin * 0.7)) {
      continue;
    }
    // for clash purposes a leaf occupies roughly its own average radius
    const reach = (a + b) / 2;
    if (taken.some((t) => Math.hypot(t.x - x, t.y - y) < t.r + reach + gap)) continue;
    return { half: a, thin: b };
  }
  return null;
}

// The panel's own frame: root at the fold, axis out toward the far tip. Motifs
// are laid out in this frame, so the same recipe drapes correctly over a
// stubby hindwing and a swept forewing alike.
interface Frame {
  root: Pt;
  ux: number;
  uy: number; // along the panel
  nx: number;
  ny: number; // across it
  length: number;
}

function frameOf(outline: Pt[], onFold: boolean[]): Frame {
  let rx = 0;
  let ry = 0;
  let n = 0;
  for (let i = 0; i < outline.length; i++) {
    if (onFold[i]) {
      rx += outline[i].x;
      ry += outline[i].y;
      n++;
    }
  }
  const root = n > 0 ? { x: rx / n, y: ry / n } : centroidOf(outline);
  let far = outline[0];
  let best = -1;
  for (const p of outline) {
    const d = Math.hypot(p.x - root.x, p.y - root.y);
    if (d > best) {
      best = d;
      far = p;
    }
  }
  const ux = (far.x - root.x) / (best || 1);
  const uy = (far.y - root.y) / (best || 1);
  return { root, ux, uy, nx: -uy, ny: ux, length: best };
}

function along(f: Frame, t: number, across: number): Pt {
  return {
    x: f.root.x + f.ux * t * f.length + f.nx * across * f.length,
    y: f.root.y + f.uy * t * f.length + f.ny * across * f.length,
  };
}

// Small holes marching just inside the outer margin — the border every
// wycinanki has, and the first thing to disappear at small scale.
function cutEyelets(outline: Pt[], onFold: boolean[], taken: Placement[], m: MotifRecipe, seed: number): Cut[] {
  const C = BUTTERFLY.cut;
  const r = lerp(C.eyeletR[0], C.eyeletR[1], m.a);
  const spacing = lerp(C.eyeletSpacing[0], C.eyeletSpacing[1], m.b);
  const inset = lerp(C.eyeletInset[0], C.eyeletInset[1], m.c);
  const centre = centroidOf(outline);
  const cuts: Cut[] = [];
  let travelled = spacing * 0.5;

  for (let i = 0; i < outline.length; i++) {
    const p = outline[i];
    const prev = outline[(i - 1 + outline.length) % outline.length];
    travelled += Math.hypot(p.x - prev.x, p.y - prev.y);
    if (travelled < spacing) continue;
    if (onFold[i]) continue;
    travelled = 0;

    const next = outline[(i + 1) % outline.length];
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const tl = Math.hypot(tx, ty) || 1;
    let nx = -ty / tl;
    let ny = tx / tl;
    if (nx * (centre.x - p.x) + ny * (centre.y - p.y) < 0) {
      nx = -nx;
      ny = -ny;
    }
    const cx = p.x + nx * inset;
    const cy = p.y + ny * inset;
    const fitted = place(outline, taken, cx, cy, r);
    if (fitted === null) continue;
    taken.push({ x: cx, y: cy, r: fitted });
    cuts.push({ kind: "hole", x: snap(cx), y: snap(cy), r: snap(fitted), points: windNegative(holePoints(cx, cy, fitted, seed + i)) });
  }
  return cuts;
}

function cutChain(outline: Pt[], f: Frame, taken: Placement[], m: MotifRecipe, seed: number): Cut[] {
  const count = 3 + Math.floor(m.a * 3);
  const r0 = lerp(BUTTERFLY.cut.chainR[0], BUTTERFLY.cut.chainR[1], m.b);
  const drift = (m.c - 0.5) * 0.14;
  const cuts: Cut[] = [];
  for (let i = 0; i < count; i++) {
    const t = 0.28 + 0.55 * (count === 1 ? 0.5 : i / (count - 1));
    const p = along(f, t, drift * (1 - t));
    const r = r0 * (1 - 0.45 * (i / count));
    const fitted = place(outline, taken, p.x, p.y, r);
    if (fitted === null) continue;
    taken.push({ x: p.x, y: p.y, r: fitted });
    cuts.push({ kind: "hole", x: snap(p.x), y: snap(p.y), r: snap(fitted), points: windNegative(holePoints(p.x, p.y, fitted, seed + i * 31)) });
  }
  return cuts;
}

function cutFan(outline: Pt[], f: Frame, taken: Placement[], m: MotifRecipe, seed: number): Cut[] {
  const count = Math.round(lerp(BUTTERFLY.cut.fanCount[0], BUTTERFLY.cut.fanCount[1], m.a));
  const spread = 0.2 + 0.36 * m.b;
  const len = lerp(BUTTERFLY.cut.fanLength[0], BUTTERFLY.cut.fanLength[1], m.c) * f.length;
  const t0 = 0.4 + 0.24 * m.d;
  const cuts: Cut[] = [];
  for (let i = 0; i < count; i++) {
    const k = count === 1 ? 0 : i / (count - 1) - 0.5;
    const swing = k * spread * 2;
    const ca = Math.cos(swing);
    const sa = Math.sin(swing);
    const dx = f.ux * ca - f.uy * sa;
    const dy = f.ux * sa + f.uy * ca;
    const p = { x: f.root.x + dx * t0 * f.length, y: f.root.y + dy * t0 * f.length };
    // the middle blade of the fan is the longest
    const half = len * (0.75 + 0.4 * (1 - Math.abs(k)));
    const ang = Math.atan2(dy, dx);
    const fitted = placeLeaf(outline, taken, p.x, p.y, half, half * 0.32, ang);
    if (fitted === null) continue;
    taken.push({ x: p.x, y: p.y, r: (fitted.half + fitted.thin) / 2 });
    cuts.push({
      kind: "leaf",
      x: snap(p.x),
      y: snap(p.y),
      // LOD reads the minor axis: a hairline slit vanishes long before a hole
      // of the same length does
      r: snap(fitted.thin * 1.6),
      points: windNegative(leafPoints(p.x, p.y, fitted.half, fitted.thin, ang, seed + i * 53)),
    });
  }
  return cuts;
}

function cutEyespot(outline: Pt[], f: Frame, taken: Placement[], m: MotifRecipe, seed: number): Cut[] {
  const R = lerp(BUTTERFLY.cut.eyespotR[0], BUTTERFLY.cut.eyespotR[1], m.a);
  const p = along(f, 0.46 + 0.2 * m.b, (m.c - 0.5) * 0.12);
  const cuts: Cut[] = [];
  const fitted = place(outline, taken, p.x, p.y, R);
  if (fitted === null) return cuts;
  taken.push({ x: p.x, y: p.y, r: fitted });
  cuts.push({ kind: "hole", x: snap(p.x), y: snap(p.y), r: snap(fitted), points: windNegative(holePoints(p.x, p.y, fitted, seed)) });

  const ring = 5 + Math.floor(m.d * 4);
  const rr = fitted * 1.95;
  const small = fitted * 0.24;
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * Math.PI * 2 + m.b;
    const q = { x: p.x + Math.cos(a) * rr, y: p.y + Math.sin(a) * rr };
    const ok = place(outline, taken, q.x, q.y, small);
    if (ok === null) continue;
    taken.push({ x: q.x, y: q.y, r: ok });
    cuts.push({ kind: "hole", x: snap(q.x), y: snap(q.y), r: snap(ok), points: windNegative(holePoints(q.x, q.y, ok, seed + 200 + i)) });
  }
  return cuts;
}

// A row of slits lying parallel to the outer margin, like the pierced band
// around the edge of a papel picado banner.
function cutBand(outline: Pt[], f: Frame, taken: Placement[], m: MotifRecipe, seed: number): Cut[] {
  const count = Math.round(lerp(BUTTERFLY.cut.bandCount[0], BUTTERFLY.cut.bandCount[1], m.a));
  const t = 0.46 + 0.24 * m.b;
  const spread = 0.12 + 0.18 * m.c;
  const a0 = (0.09 + 0.07 * m.d) * f.length;
  // slits lie across the panel, at right angles to the run of the wing
  const ang = Math.atan2(f.ny, f.nx);
  const cuts: Cut[] = [];
  for (let i = 0; i < count; i++) {
    const k = count === 1 ? 0 : i / (count - 1) - 0.5;
    const p = along(f, t + k * 0.26, k * spread * 0.6);
    const fitted = placeLeaf(outline, taken, p.x, p.y, a0, a0 * 0.3, ang);
    if (fitted === null) continue;
    taken.push({ x: p.x, y: p.y, r: (fitted.half + fitted.thin) / 2 });
    cuts.push({
      kind: "leaf",
      x: snap(p.x),
      y: snap(p.y),
      r: snap(fitted.thin * 1.6),
      points: windNegative(leafPoints(p.x, p.y, fitted.half, fitted.thin, ang, seed + i * 71)),
    });
  }
  return cuts;
}

// Both sides of the fold get the *same* recipe — a butterfly is one creature,
// cut through folded paper. The near-miss between its halves comes from the
// panels being slightly different shapes, not from a different pattern.
function applyMotif(
  outline: Pt[],
  onFold: boolean[],
  recipe: MotifRecipe,
  eyelets: boolean,
  eyeletRecipe: MotifRecipe,
  seed: number,
): Cut[] {
  const f = frameOf(outline, onFold);
  const taken: Placement[] = [];
  let cuts: Cut[] = [];
  switch (recipe.kind) {
    case "chain":
      cuts = cutChain(outline, f, taken, recipe, seed);
      break;
    case "fan":
      cuts = cutFan(outline, f, taken, recipe, seed);
      break;
    case "eyespot":
      cuts = cutEyespot(outline, f, taken, recipe, seed);
      break;
    case "band":
      cuts = cutBand(outline, f, taken, recipe, seed);
      break;
  }
  if (eyelets) cuts = cuts.concat(cutEyelets(outline, onFold, taken, eyeletRecipe, seed + 900));
  // A wing that placed almost nothing is a blank wing. Some panels are simply
  // too thin for the recipe they drew; fall back to the motif that fits nearly
  // anywhere, and then to the margin, which follows whatever shape it is given.
  if (cuts.length < 2) {
    cuts = cuts.concat(cutChain(outline, f, taken, { ...recipe, kind: "chain" }, seed + 1700));
  }
  if (cuts.length < 2) {
    cuts = cuts.concat(cutEyelets(outline, onFold, taken, eyeletRecipe, seed + 2600));
  }
  // biggest first, so the level-of-detail cut-off keeps what carries the shape
  cuts.sort((p, q) => q.r - p.r);
  return cuts;
}

// --- derivation ------------------------------------------------------------

const MOTIF_KINDS: MotifKind[] = ["eyespot", "fan", "chain", "band"];

function recipe(r: () => number, kind: MotifKind): MotifRecipe {
  return { kind, a: snap(r()), b: snap(r()), c: snap(r()), d: snap(r()) };
}

function transformAnchor(a: Anchor, s: SideAsymmetry, yScale: number): Anchor {
  let x = a.x * s.scaleX;
  let y = a.y * yScale * s.scaleY + s.shiftY;
  if (!a.onFold) {
    // rotate the wing slightly off the fold; anchors *on* the fold must stay
    // on it or the two halves stop meeting
    const c = Math.cos(s.rotate);
    const sn = Math.sin(s.rotate);
    const rx = x * c - y * sn;
    const ry = x * sn + y * c;
    x = rx;
    y = ry;
  }
  return { x: x * s.side, y, onFold: a.onFold };
}

export function deriveButterfly(id: string): ButterflySpec {
  const G = BUTTERFLY.gene;
  const g = stream(id, 0x01);
  const mrng = stream(id, 0x02);
  const arng = stream(id, 0x03);
  const seed = hashString(id);

  // --- genes
  const foreRootTop = -pick(g, G.foreRootTop);
  const foreTipX = pick(g, G.foreTipX);
  const foreTipY = -pick(g, G.foreTipY);
  const foreLeadBow = pick(g, G.foreLeadBow);
  const foreOuterX = Math.min(pick(g, G.foreOuterX), foreTipX - 0.05);
  const foreOuterY = pick(g, G.foreOuterY);
  const foreOuterBow = pick(g, G.foreOuterBow);
  const foreTrailBow = pick(g, G.foreTrailBow);
  const foreRootBot = pick(g, G.foreRootBot);
  const foreNotches = pickInt(g, G.foreNotches);
  const foreNotchDepth = pick(g, G.foreNotchDepth);

  const hindRootTop = foreRootBot - 0.045; // tucked under the forewing
  const hindOutX = pick(g, G.hindOutX);
  const hindOutY = pick(g, G.hindOutY);
  const hindLeadBow = pick(g, G.hindLeadBow);
  const hindRootBot = pick(g, G.hindRootBot);
  const hindTailX = pick(g, G.hindTailX);
  const hindTailY = Math.max(pick(g, G.hindTailY), hindRootBot + 0.06);
  const hindTrailBow = pick(g, G.hindTrailBow);
  const hindScallops = pickInt(g, G.hindScallops);
  const hindScallopDepth = pick(g, G.hindScallopDepth);

  const bodyWidth = pick(g, G.bodyWidth);
  const bodySegments = pickInt(g, G.bodySegments);
  const antennaLen = pick(g, G.antennaLen);
  const antennaSpread = pick(g, G.antennaSpread);
  const antennaCurl = pick(g, G.antennaCurl);
  const yScale = pick(g, G.yScale);

  // --- pattern, chosen once for the whole creature
  const motifs = {
    fore: recipe(mrng, MOTIF_KINDS[Math.floor(mrng() * MOTIF_KINDS.length) % MOTIF_KINDS.length]),
    hind: recipe(mrng, MOTIF_KINDS[Math.floor(mrng() * MOTIF_KINDS.length) % MOTIF_KINDS.length]),
    eyelets: mrng() < 0.6,
  };
  const eyeletRecipe = recipe(mrng, "chain");

  // --- the two halves
  const A = BUTTERFLY.asymmetry;
  const asymmetry: SideAsymmetry[] = ([-1, 1] as const).map((side) => ({
    side,
    scaleX: 1 + (arng() - 0.5) * 2 * A.scaleX,
    scaleY: 1 + (arng() - 0.5) * 2 * A.scaleY,
    rotate: (arng() - 0.5) * 2 * A.rotate,
    shiftY: (arng() - 0.5) * 2 * A.shiftY,
  }));

  const foreAnchors: Anchor[] = [
    { x: 0, y: foreRootTop, onFold: true },
    { x: foreTipX, y: foreTipY, onFold: false },
    { x: foreOuterX, y: foreOuterY, onFold: false },
    { x: 0, y: foreRootBot, onFold: true },
  ];
  const foreEdges: Edge[] = [
    { bow: foreLeadBow },
    foreNotches > 0
      ? { bow: foreOuterBow, scallops: foreNotches, scallopDepth: foreNotchDepth }
      : { bow: foreOuterBow },
    { bow: foreTrailBow },
    { bow: 0 },
  ];

  const hindAnchors: Anchor[] = [
    { x: 0, y: hindRootTop, onFold: true },
    { x: hindOutX, y: hindOutY, onFold: false },
    { x: hindTailX, y: hindTailY, onFold: false },
    { x: 0, y: hindRootBot, onFold: true },
  ];
  const hindEdges: Edge[] = [
    { bow: hindLeadBow },
    { bow: hindTrailBow, scallops: hindScallops, scallopDepth: hindScallopDepth },
    { bow: hindTrailBow * 0.4 },
    { bow: 0 },
  ];

  const panels: WingPanel[] = [];
  // hindwings first: the panel list is in draw order, back to front
  for (const kind of ["hind", "fore"] as const) {
    const anchors = kind === "fore" ? foreAnchors : hindAnchors;
    const edges = kind === "fore" ? foreEdges : hindEdges;
    for (const s of asymmetry) {
      const placed = anchors.map((a) => transformAnchor(a, s, yScale));
      const jitterSeed = (seed ^ (s.side === 1 ? 0x1a2b : 0x7c3d) ^ (kind === "fore" ? 0 : 0x55aa)) >>> 0;
      const built = buildOutline(placed, edges, jitterSeed);
      const outline = windPositive(built.outline);
      // reversing to canonicalise the winding must take onFold with it
      const flipped = outline !== built.outline;
      const onFold = flipped ? built.onFold.slice().reverse() : built.onFold;
      panels.push({
        side: s.side,
        kind,
        outline,
        onFold,
        cuts: applyMotif(
          outline,
          onFold,
          kind === "fore" ? motifs.fore : motifs.hind,
          motifs.eyelets,
          eyeletRecipe,
          (jitterSeed ^ 0x3f5b) >>> 0,
        ),
      });
    }
  }

  // --- body: a folded strip lying along the ridge
  const bodyTop = foreRootTop * yScale - 0.055;
  const bodyBot = Math.min(hindRootBot * yScale + 0.13, hindTailY * yScale * 0.96);
  const body = buildBody(bodyTop, bodyBot, bodyWidth, bodySegments, asymmetry, seed);

  const antennae = buildAntennae(bodyTop, antennaLen, antennaSpread, antennaCurl, seed);

  return {
    id,
    version: BUTTERFLY.version,
    extent: computeExtent(panels, body, antennae),
    fold: { top: snap(bodyTop), bottom: snap(bodyBot) },
    panels,
    body,
    antennae,
    asymmetry: asymmetry.map((s) => ({
      side: s.side,
      scaleX: snap(s.scaleX),
      scaleY: snap(s.scaleY),
      rotate: snap(s.rotate),
      shiftY: snap(s.shiftY),
    })),
    motifs,
  };
}

// Head bulge, thorax, tapering abdomen — three overlapping humps, so the neck
// falls out of the maths instead of being drawn.
function bodyHalfWidth(t: number, w: number): number {
  const head = Math.exp(-Math.pow((t - 0.085) / 0.075, 2)) * 0.82;
  const thorax = Math.exp(-Math.pow((t - 0.31) / 0.14, 2));
  const abdomen = t > 0.36 ? Math.max(0, 1 - Math.pow((t - 0.4) / 0.63, 2)) * 0.7 : 0;
  return w * Math.max(head, thorax, abdomen);
}

function buildBody(
  top: number,
  bot: number,
  w: number,
  segments: number,
  asym: SideAsymmetry[],
  seed: number,
): BodySpec {
  const steps = 26;
  const right: Pt[] = [];
  const left: Pt[] = [];
  const sx = (side: -1 | 1) => asym.find((a) => a.side === side)!.scaleX;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = lerp(top, bot, t);
    const hw = bodyHalfWidth(t, w);
    const wob = (hash(i, seed, 0x8f1) - 0.5) * 2 * 0.0016;
    right.push(pt(hw * sx(1) + wob, y));
    left.push(pt(-hw * sx(-1) + wob, y));
  }
  const outline = windPositive(right.concat(left.reverse()));

  const crease: number[] = [];
  for (let i = 1; i <= segments; i++) {
    crease.push(snap(lerp(top + (bot - top) * 0.42, bot, i / (segments + 1))));
  }
  return { outline, segments: crease };
}

function buildAntennae(
  headY: number,
  len: number,
  spread: number,
  curl: number,
  seed: number,
): AntennaSpec[] {
  const out: AntennaSpec[] = [];
  for (const side of [-1, 1] as const) {
    const jitter = (hash(side, seed, 0x2c9) - 0.5) * 2;
    const l = len * (1 + jitter * 0.08);
    const sp = spread * (1 + jitter * 0.1);
    const x0 = side * 0.006;
    const y0 = headY + 0.012;
    const x1 = side * sp * l;
    const y1 = y0 - l;
    // control point pushed outward so the antenna sweeps rather than kinks
    const cx = side * sp * l * (0.15 + curl);
    const cy = y0 - l * (0.75 + curl * 0.3);
    const pts: Pt[] = [];
    const n = 7;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      pts.push(pt(u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1));
    }
    out.push({ points: pts, clubR: snap(0.011 + Math.abs(jitter) * 0.004) });
  }
  return out;
}

function computeExtent(
  panels: WingPanel[],
  body: BodySpec,
  antennae: AntennaSpec[],
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const eat = (p: Pt, pad = 0) => {
    if (p.x - pad < minX) minX = p.x - pad;
    if (p.y - pad < minY) minY = p.y - pad;
    if (p.x + pad > maxX) maxX = p.x + pad;
    if (p.y + pad > maxY) maxY = p.y + pad;
  };
  for (const panel of panels) for (const p of panel.outline) eat(p);
  for (const p of body.outline) eat(p);
  for (const a of antennae) for (const p of a.points) eat(p, a.clubR);
  return { minX: snap(minX), minY: snap(minY), maxX: snap(maxX), maxY: snap(maxY) };
}
