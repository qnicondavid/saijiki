// Holes in the back sheet.
//
// CLAUDE.md: "The back wall of the diorama is a single sheet of paper. Every
// butterfly is cut *from it*, and its silhouette stays behind as a hole. The
// sheet accumulates holes forever; printed, it is the year-end poster."
//
// So a hole is not decoration and not a record of an event — it is the negative
// of a creature, and it is a *function of the id*. Nothing about it is
// persisted, and nothing needs to be: `deriveButterfly(id)` gives the outline
// and the id's own noise stream gives the place. That is the same rule the
// butterfly itself obeys, and it has the same payoff — the year-end poster is
// not an artefact to be maintained alongside the diary, it is the diary read
// backwards.
//
// --- how big a hole is --------------------------------------------------------
//
// This started at 0.14 of the sheet's width, which is a wingspan of 46 css px:
// half again as large as any butterfly the box ever draws. Measured against a
// hundred and fifty synthetic kigo on the shipped 330x206 sheet, that removes
//
//   size 0.14, the old placement band   37% of the sheet, 77% of the band
//   size 0.14, over the whole sheet     56% of the sheet
//
// and seventy-seven per cent of a band is not lace and not damage. It is a
// sheet with its middle missing — three parts air to one part paper, with a
// solid strip above and below where the margins forbade cutting.
//
// The range the picture is allowed to sit in comes from perspective. The plane
// at the glass draws FLIGHT.wingspan, the back plane draws PLANES.farScale of
// that, and the sheet is the back wall — but it is drawn filling the mouth of
// the box rather than foreshortened into it, so a creature lying on it is
// somewhere between the two rather than at either end. That is 13 to 26 css px,
// and a hole outside it says the creature changed size on the way out.
//
// Inside that range the eye decides, and both ends of the app's life have a
// vote. 0.08 — a full 26 px — puts a hundred and fifty silhouettes shoulder to
// shoulder and they merge into a crowd. 0.04 leaves a sheet that is beautifully
// airy at a hundred and fifty and a single grey speck at one, and one entry is
// not a state to rush past: it is the first several months of real use, and
// CLAUDE.md is explicit that it has to be lovely on its own.
//
//   size 0.05, over the whole sheet     16% of the sheet at a hundred and fifty
//
// Sixteen per cent is a sheet that has visibly been worked a hundred and fifty
// times and is still, unmistakably, a sheet. The count is what says *worked*;
// the coverage only decides whether anything is left.
//
// The band was widened at the same time and for the same reason: reserving the
// bottom third for the scissors was reserving it against nothing, since the
// scissors and the row of folded squares are drawn *on top* of the sheet and a
// hole behind them simply does not show. Cutting over the whole sheet spreads
// the same number of holes over twice the paper, and it is what the poster
// wants.
//
// --- why the outline and not the cuts ----------------------------------------
//
// A butterfly is punched with holes of its own, and it would be prettier to
// show them here as lacy islands inside the silhouette. They are not drawn,
// because they would be lies: an island of paper inside a cut-out is attached
// to nothing. The punched scraps fall out with the creature. The sheet keeps
// the outline, and only the outline.
//
// The antennae are missing for the opposite reason: a real pair of scissors
// would leave two hairline slits, and a hairline slit at this size is invisible.

import { deriveButterfly, type ButterflySpec, type Pt } from "./butterfly";
import { stream } from "./noise";
import { lightVector, type Rect } from "./paper";
import { rgba } from "./papers";
import type { Knob } from "./tuning-panel";

export const HOLES = {
  // The silhouette's wingspan on the sheet, as a fraction of the sheet's width.
  // 0.05 is 16.5 css px at the shipped window: between a butterfly at the back
  // of the box and one at the glass, which is the range above. A fraction rather
  // than a pixel count, so it survives a resize the way everything else that
  // lives on the paper does — and so this module does not have to know that
  // flight exists.
  size: 0.05,

  // Where a hole may fall, as an inset from the sheet. Small, and even: the
  // whole sheet is cuttable, because the whole sheet is what the creatures came
  // out of. The scissors and the row of folded squares lie *on* it and hide
  // whatever is behind them, which costs nothing.
  marginX: 0.05,
  marginTop: 0.05,
  marginBottom: 0.09,

  cutSec: 0.85, // how long the blade takes to travel down the silhouette

  // What shows through. Darker than the floor visible *beside* the sheet, and
  // that is the whole of what makes a hole read as a hole rather than as a grey
  // butterfly lying on the paper: the sheet is resting on that floor, so the
  // light reaching it through a hole has to come in almost edge-on. A hole the
  // same value as the margin around the sheet reads as a cut-out stuck on top,
  // which is exactly backwards and was the first thing this got wrong.
  floor: [104, 92, 74] as [number, number, number],
  floorAlpha: 0.95,
  wallAlpha: 0.6, // the shadow the sheet's own thickness throws inward
  wallLight: 0.3, // and the sliver of far wall that catches the light
  freshAlpha: 0.75, // the pale flash of a cut that has just been made

  // How thick the sheet is, in css px.
  //
  // A constant, and it must be: paper is one thickness and a small hole is not
  // cut in thinner paper than a large one. This used to be a fraction of the
  // hole's own scale, which was invisible at the size a hole actually is and
  // then flooded the whole silhouette with wall shadow — three passes at three
  // times that depth is wider than a 13 px creature's wing, so every hole came
  // out as a solid dark shape and read as a butterfly lying on the sheet rather
  // than as a gap in it.
  wall: 0.45,

  // --- what an old cut looks like ----------------------------------------
  //
  // CLAUDE.md, of butterflies: "Untouched entries go crisp but pale
  // (sun-bleached)." The sheet is in the same light. A cut made this season is
  // dark and sharp; one made four years ago has had four years of sun on its
  // edges and on the floor behind it, and it has gone quiet.
  //
  // That is what keeps a hundred and fifty of them from reading as a static
  // field of identical marks — the season's cuts are events and the rest are
  // history — and it is the same seasonal curve the swarm bleaches on, counted
  // from the day the cut was made rather than from the last touch. See
  // `freshnessOf`. Nothing here ever reaches nothing: the sheet accumulates
  // holes *forever*, and the year-end poster needs every one of them.

  aged: 0.45, // how much of its edge a settled cut keeps
  bleach: 0.5, // how far a settled cut's floor has come toward the paper
  paper: [236, 226, 208] as [number, number, number], // what it is coming toward
};

/** A cut in the sheet: which creature made it, and how long ago. */
export interface Cut {
  id: string;
  /** 1 the season it was made, 0 once it has settled. See `freshnessOf`. */
  fresh: number;
}

interface Hole {
  id: string;
  spec: ButterflySpec;
  fresh: number;
  /** 0 not yet cut, 1 fully open. Only ever climbs. */
  cut: number;
}

let holes: Hole[] = [];

// Bumped whenever the picture would change. The whole sheet's worth is drawn
// once into an offscreen and blitted after that — see `drawHoles` — so this is
// what tells the layer it has gone stale.
let revision = 0;

/**
 * Every kigo whose paper has left the sheet, in one call.
 *
 * Handed the whole set rather than one at a time, and reconciled by id, because
 * this list is a function of the day: scrub backwards and the cuts that have not
 * been made yet leave it, scrub forward and they return. A hole that is already
 * open stays exactly as open as it was, so nothing re-cuts itself on a keypress.
 *
 * One that has not been seen before is already fully cut. It is not new — it is
 * a cut made months ago that this process is only now finding out about, and an
 * app that opened by re-cutting a hundred and fifty holes would be a very
 * strange way to say "here is your sheet".
 */
export function setHoles(list: readonly Cut[]): void {
  const before = new Map(holes.map((h) => [h.id, h]));
  const next: Hole[] = [];
  let changed = holes.length !== list.length;
  for (const one of list) {
    const already = before.get(one.id);
    if (already) {
      if (already.fresh !== one.fresh) changed = true;
      already.fresh = one.fresh;
      next.push(already);
    } else {
      changed = true;
      next.push({ id: one.id, spec: deriveButterfly(one.id), fresh: one.fresh, cut: 1 });
    }
  }
  holes = next;
  if (changed) revision++;
}

/**
 * The blade goes in now.
 *
 * The recording ceremony's own call, and the one case where a hole is watched
 * being made. It arrives *after* `setHoles` has already listed this kigo — the
 * entry is written to disk before the paper moves — so this resets a hole that
 * exists rather than adding one.
 */
export function cutHole(id: string): void {
  const already = holes.find((h) => h.id === id);
  if (already) already.cut = 0;
  else holes.push({ id, spec: deriveButterfly(id), fresh: 1, cut: 0 });
  revision++;
}

export function holeCount(): number {
  return holes.length;
}

/** How many are still under the blade. Zero, nearly always. */
export function cuttingCount(): number {
  let n = 0;
  for (const h of holes) if (h.cut < 1) n++;
  return n;
}

/** Tests, and starting over. */
export function clearHoles(): void {
  holes = [];
  revision++;
}

/** One frame of the blade travelling. */
export function stepHoles(dt: number): void {
  if (dt <= 0) return;
  const per = dt / Math.max(0.05, HOLES.cutSec);
  for (const hole of holes) {
    if (hole.cut < 1) {
      hole.cut = Math.min(1, hole.cut + per);
      // A cut that has just finished belongs in the layer with the rest of
      // them, and until this says so it would be drawn live forever.
      if (hole.cut >= 1) revision++;
    }
  }
}

/**
 * Where this creature was cut from, in css px.
 *
 * Derived from the id and the sheet, so it is the same place on every machine,
 * forever, and it survives the file being renamed, re-filed, re-worded or
 * hand-edited. It also survives a resize, which is the point of deriving it from
 * the sheet rather than remembering it: the holes move with the paper.
 *
 * A salt of its own, so that adding this did not reshuffle a single gene of a
 * single existing butterfly — see `stream` in noise.ts.
 */
export function holeAt(id: string, sheet: Rect): { x: number; y: number; scale: number } {
  const r = stream(id, 0x11);
  const scale = Math.max(4, sheet.w * HOLES.size);
  const spec = deriveButterfly(id);
  const e = spec.extent;
  // The room left once the creature's own footprint is accounted for, so a hole
  // is never half off the paper however the placement falls.
  const left = sheet.x + sheet.w * HOLES.marginX - e.minX * scale;
  const right = sheet.x + sheet.w * (1 - HOLES.marginX) - e.maxX * scale;
  const top = sheet.y + sheet.h * HOLES.marginTop - e.minY * scale;
  const bottom = sheet.y + sheet.h * (1 - HOLES.marginBottom) - e.maxY * scale;
  return {
    x: left + Math.max(0, right - left) * r(),
    y: top + Math.max(0, bottom - top) * r(),
    scale,
  };
}

// --- drawing -----------------------------------------------------------------
//
// A hundred and fifty holes is a hundred and fifty clipped fills and nine
// hundred stroke passes, and none of it moves. So the settled ones are drawn
// once into a canvas the size of the sheet and blitted from then on, and the
// layer is thrown away only when something has actually changed: the sheet
// resized, the day moved, an entry was recorded. The one hole that *is* moving —
// a cut being made, which happens once every few weeks — is drawn live on top.
//
// The alternative is 150 paths per frame all day, on a widget whose entire job
// is to sit in the corner of someone's screen without costing them anything.
//
// The layer takes about 45ms to build at a hundred and fifty, and nothing per
// frame after that. That cost lands on a season scrub, on startup, and on the
// window changing size — and the widget's window is not resizable, so the last
// of those is only the dev views handing it back and forth. A keypress that
// costs one long frame is the right side of the trade; a hundred and fifty
// paths every frame for the rest of the day is not.

const PAD = 6; // css px of room around the sheet for a rim to spill into

let layer: HTMLCanvasElement | null = null;
let layerKey = "";

export function drawHoles(ctx: CanvasRenderingContext2D, sheet: Rect, dpr: number): void {
  if (holes.length === 0) return;

  const key = `${sheet.x.toFixed(1)},${sheet.y.toFixed(1)},${sheet.w.toFixed(1)},${sheet.h.toFixed(1)}|${dpr}|${revision}|${configKey()}`;
  if (key !== layerKey) {
    layer = buildLayer(sheet, dpr);
    layerKey = key;
  }
  if (layer) ctx.drawImage(layer, sheet.x - PAD, sheet.y - PAD, layer.width / dpr, layer.height / dpr);

  for (const hole of holes) {
    if (hole.cut < 1) drawHole(ctx, hole, sheet);
  }
}

/** Every hole that has finished opening, on one sheet-sized piece of glass. */
function buildLayer(sheet: Rect, dpr: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil((sheet.w + PAD * 2) * dpr));
  canvas.height = Math.max(1, Math.ceil((sheet.h + PAD * 2) * dpr));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // The layer's own origin is the sheet's, less the padding, so everything
  // below can go on working in the sheet's coordinates and never know.
  ctx.translate(PAD - sheet.x, PAD - sheet.y);
  for (const hole of holes) {
    if (hole.cut >= 1) drawHole(ctx, hole, sheet);
  }
  return canvas;
}

function drawHole(ctx: CanvasRenderingContext2D, hole: Hole, sheet: Rect): void {
  const at = holeAt(hole.id, sheet);
  const path = silhouette(hole.spec, at.x, at.y, at.scale);
  const e = hole.spec.extent;
  const top = at.y + e.minY * at.scale;
  const height = (e.maxY - e.minY) * at.scale;
  const edge = top + height * hole.cut;
  // Just the creature's own footprint, rather than the whole sheet: at one hole
  // the difference is nothing and at a hundred and fifty it is the difference
  // between a layer that builds in a frame and one that does not.
  const box = {
    x: at.x + e.minX * at.scale - 2,
    y: top - 2,
    w: (e.maxX - e.minX) * at.scale + 4,
    h: height + 4,
  };

  // How much of itself this cut has kept: 1 the season it was made, and never
  // less than `aged`. A fresh one is dark and sharp, an old one has gone quiet.
  const fresh = clamp01(hole.fresh);
  const keep = HOLES.aged + (1 - HOLES.aged) * fresh;

  ctx.save();
  // The blade travels down the shape, so what exists is whatever is above the
  // line it has reached. A straight sweep is not how a silhouette is really
  // cut, but it is how one *reads*, and reading is the job here: a hole that
  // simply appeared would be an event nobody saw happen.
  if (hole.cut < 1) {
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, Math.max(0, edge - box.y));
    ctx.clip();
  }
  ctx.clip(path);

  // What is behind the sheet: the floor of the box, in the sheet's own shadow —
  // bleached toward the paper by however many seasons of light have been on it.
  // Solid, and mixed rather than faded: a hole with the sheet's fibre showing
  // through it is not a hole.
  ctx.fillStyle = rgba(mix(HOLES.floor, HOLES.paper, HOLES.bleach * (1 - fresh)), HOLES.floorAlpha);
  ctx.fillRect(box.x, box.y, box.w, box.h);

  // The paper's thickness, seen from the inside. In a hole the lighting is the
  // *inverse* of the lighting on a piece of paper: the near wall is the one the
  // light has to get past, so it is the wall in shadow, and the far wall is the
  // only one lit. On a butterfly it is the other way about, which is why this
  // does not go through `strokeCutEdge` — the two would look like the same call
  // written wrong rather than like two different facts.
  //
  // The lit sliver is kept faint on purpose, and it is the part that settles
  // most: any brighter and the shape stops being a hole and becomes a small pale
  // creature sitting on the sheet, which is exactly what an old cut has stopped
  // doing.
  const depth = Math.max(0.2, HOLES.wall);
  rim(ctx, path, -1, [24, 17, 10], HOLES.wallAlpha * (0.55 + 0.45 * keep), depth);
  rim(ctx, path, 1, [255, 248, 232], HOLES.wallLight * keep, depth);

  // A cut made a moment ago shows raw fibre along the line the blade is on. It
  // goes as the hole finishes opening — paper does not stay startled.
  if (hole.cut > 0 && hole.cut < 1) {
    ctx.strokeStyle = rgba([255, 250, 238], HOLES.freshAlpha);
    ctx.lineWidth = Math.max(0.8, at.scale * 0.03);
    ctx.beginPath();
    ctx.moveTo(box.x, edge);
    ctx.lineTo(box.x + box.w, edge);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * A soft band inside the shape, hugging one side of it.
 *
 * The stroke is displaced along the light and the clip keeps only the half that
 * lands inside, so `toward: 1` leaves a band on the side *away* from the light
 * and `-1` on the side facing it. Three passes of decreasing width and rising
 * alpha, because a single hard band reads as a drawn outline and this is meant
 * to be a wall a few tenths of a millimetre deep.
 */
function rim(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  toward: 1 | -1,
  colour: [number, number, number],
  alpha: number,
  depth: number,
): void {
  if (alpha <= 0.004) return;
  const L = lightVector();
  ctx.lineJoin = "round";
  for (let i = 3; i >= 1; i--) {
    const spread = depth * i;
    ctx.save();
    ctx.lineWidth = spread * 2; // doubled: the clip eats the outward half
    ctx.strokeStyle = rgba(colour, alpha / (i * 1.4));
    ctx.translate(L.x * spread * toward, L.y * spread * toward);
    ctx.stroke(path);
    ctx.restore();
  }
}

/**
 * The creature laid flat, as one closed region.
 *
 * The panels are taken at their unfolded angle — theta zero, where the
 * projection in butterfly-render is the identity — because this is the shape
 * the piece had while it was still part of the sheet. It had not been folded
 * yet. That is also why the two halves meet along the fold with no gap: the
 * mountain crease is a line drawn on a flat piece of paper, not a hinge.
 */
export function silhouette(spec: ButterflySpec, x: number, y: number, scale: number): Path2D {
  const path = new Path2D();
  const add = (poly: Pt[]) => {
    const sub = new Path2D();
    poly.forEach((p, i) => {
      const px = x + p.x * scale;
      const py = y + p.y * scale;
      if (i === 0) sub.moveTo(px, py);
      else sub.lineTo(px, py);
    });
    sub.closePath();
    path.addPath(sub);
  };
  for (const panel of spec.panels) add(panel.outline);
  add(spec.body.outline);
  return path;
}

// --- the panel's view of all this --------------------------------------------

/**
 * The constants that change what the layer looks like, as a string.
 *
 * The tuning panel writes straight into HOLES, so nothing calls a setter this
 * module could notice. Making them part of the layer's key is what lets a
 * slider move a hundred and fifty holes — without it, dragging `size` would
 * move the one being cut and leave the other hundred and forty-nine where they
 * were, which looks exactly like a bug in the placement.
 */
function configKey(): string {
  const H = HOLES;
  return [
    H.size,
    H.marginX,
    H.marginTop,
    H.marginBottom,
    H.floorAlpha,
    H.wallAlpha,
    H.wallLight,
    H.wall,
    H.aged,
    H.bleach,
  ].join(",");
}

export function holeKnobs(): Knob[] {
  const H = HOLES as unknown as Record<string, number>;
  const knob = (key: string, min: number, max: number, step: number): Knob => ({
    group: "holes",
    label: key,
    min,
    max,
    step,
    get: () => H[key],
    set: (v) => {
      H[key] = v;
    },
  });

  return [
    knob("size", 0.01, 0.2, 0.002),
    knob("marginX", 0, 0.4, 0.01),
    knob("marginTop", 0, 0.4, 0.01),
    knob("marginBottom", 0, 0.6, 0.01),
    knob("cutSec", 0.1, 3, 0.05),
    knob("floorAlpha", 0, 1, 0.01),
    knob("wallAlpha", 0, 1.5, 0.01),
    knob("wallLight", 0, 1, 0.01),
    knob("freshAlpha", 0, 1, 0.01),
    knob("wall", 0.1, 3, 0.05),
    knob("aged", 0, 1, 0.01),
    knob("bleach", 0, 1, 0.01),
  ];
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

type RGB = [number, number, number];

function mix(a: RGB, b: RGB, t: number): RGB {
  const k = clamp01(t);
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}
