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
// butterfly itself obeys, and it has the same payoff — the poster in step 17 is
// not an artefact to be maintained alongside the diary, it is the diary read
// backwards.
//
// This step cuts one hole, at the moment of recording, and it stays. Making
// every past entry's hole appear on the sheet is step 13; when it arrives it
// hands this module a list of ids instead of one, and nothing else here moves.
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
  // Larger than a butterfly at the glass, because this is the creature lying
  // flat and life-size on the paper it came from, not one seen across a box.
  size: 0.14,

  // Where a hole may fall, as an inset from the sheet. The bottom is kept
  // clearer than the top: the scissors lie down there, and so does the row of
  // folded squares.
  marginX: 0.1,
  marginTop: 0.1,
  marginBottom: 0.3,

  cutSec: 0.85, // how long the blade takes to travel down the silhouette

  // What shows through. Darker than the floor visible *beside* the sheet, and
  // that is the whole of what makes a hole read as a hole rather than as a grey
  // butterfly lying on the paper: the sheet is resting on that floor, so the
  // light reaching it through a hole has to come in almost edge-on. A hole the
  // same value as the margin around the sheet reads as a cut-out stuck on top,
  // which is exactly backwards and was the first thing this got wrong.
  floor: [104, 92, 74] as [number, number, number],
  floorAlpha: 0.95,
  wallAlpha: 0.72, // the shadow the sheet's own thickness throws inward
  wallLight: 0.22, // and the sliver of far wall that catches the light
  freshAlpha: 0.75, // the pale flash of a cut that has just been made
};

interface Hole {
  id: string;
  spec: ButterflySpec;
  /** 0 not yet cut, 1 fully open. Only ever climbs. */
  cut: number;
}

const holes: Hole[] = [];

/**
 * Cut one. The reveal starts at zero and is stepped from there, so the caller
 * says *when* rather than having to drive *how*.
 */
export function cutHole(id: string): void {
  if (holes.some((h) => h.id === id)) return;
  holes.push({ id, spec: deriveButterfly(id), cut: 0 });
}

export function holeCount(): number {
  return holes.length;
}

/** Tests, and starting over. */
export function clearHoles(): void {
  holes.length = 0;
}

/** One frame of the blade travelling. */
export function stepHoles(dt: number): void {
  if (dt <= 0) return;
  const per = dt / Math.max(0.05, HOLES.cutSec);
  for (const hole of holes) {
    if (hole.cut < 1) hole.cut = Math.min(1, hole.cut + per);
  }
}

/**
 * Where this creature was cut from, in css px.
 *
 * Derived from the id and the sheet, so it is the same place on every machine,
 * forever, and it survives the file being renamed, re-filed, re-worded or
 * hand-edited. A salt of its own, so that adding this did not reshuffle a
 * single gene of a single existing butterfly — see `stream` in noise.ts.
 */
export function holeAt(id: string, sheet: Rect): { x: number; y: number; scale: number } {
  const r = stream(id, 0x11);
  const scale = Math.max(8, sheet.w * HOLES.size);
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

// A path per hole per frame. Fine for the one this step cuts; step 13 puts a
// whole diary's worth on the sheet and will want them kept.
export function drawHoles(ctx: CanvasRenderingContext2D, sheet: Rect): void {
  for (const hole of holes) drawHole(ctx, hole, sheet);
}

function drawHole(ctx: CanvasRenderingContext2D, hole: Hole, sheet: Rect): void {
  const at = holeAt(hole.id, sheet);
  const path = silhouette(hole.spec, at.x, at.y, at.scale);
  const e = hole.spec.extent;
  const top = at.y + e.minY * at.scale;
  const height = (e.maxY - e.minY) * at.scale;
  const edge = top + height * hole.cut;

  ctx.save();
  // The blade travels down the shape, so what exists is whatever is above the
  // line it has reached. A straight sweep is not how a silhouette is really
  // cut, but it is how one *reads*, and reading is the job here: a hole that
  // simply appeared would be an event nobody saw happen.
  if (hole.cut < 1) {
    ctx.beginPath();
    ctx.rect(sheet.x - 4, sheet.y - 4, sheet.w + 8, Math.max(0, edge - sheet.y + 4));
    ctx.clip();
  }
  ctx.clip(path);

  // What is behind the sheet: the floor of the box, in the sheet's own shadow.
  ctx.fillStyle = rgba(HOLES.floor, HOLES.floorAlpha);
  ctx.fillRect(sheet.x - 4, sheet.y - 4, sheet.w + 8, sheet.h + 8);

  // The paper's thickness, seen from the inside. In a hole the lighting is the
  // *inverse* of the lighting on a piece of paper: the near wall is the one the
  // light has to get past, so it is the wall in shadow, and the far wall is the
  // only one lit. On a butterfly it is the other way about, which is why this
  // does not go through `strokeCutEdge` — the two would look like the same call
  // written wrong rather than like two different facts.
  //
  // The lit sliver is kept faint on purpose. Any more and the shape stops being
  // a hole and becomes a small pale creature sitting on the sheet.
  const depth = Math.max(1.2, at.scale * 0.05);
  rim(ctx, path, -1, [24, 17, 10], HOLES.wallAlpha, depth);
  rim(ctx, path, 1, [226, 212, 186], HOLES.wallLight, depth * 0.6);

  // A cut made a moment ago shows raw fibre along the line the blade is on. It
  // goes as the hole finishes opening — paper does not stay startled.
  if (hole.cut > 0 && hole.cut < 1) {
    ctx.strokeStyle = rgba([255, 250, 238], HOLES.freshAlpha);
    ctx.lineWidth = Math.max(0.8, at.scale * 0.03);
    ctx.beginPath();
    ctx.moveTo(at.x + e.minX * at.scale - 2, edge);
    ctx.lineTo(at.x + e.maxX * at.scale + 2, edge);
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
    knob("size", 0.04, 0.4, 0.005),
    knob("marginX", 0, 0.4, 0.01),
    knob("marginTop", 0, 0.4, 0.01),
    knob("marginBottom", 0, 0.6, 0.01),
    knob("cutSec", 0.1, 3, 0.05),
    knob("floorAlpha", 0, 1, 0.01),
    knob("wallAlpha", 0, 1.5, 0.01),
    knob("wallLight", 0, 1, 0.01),
    knob("freshAlpha", 0, 1, 0.01),
  ];
}
