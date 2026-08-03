// A pair of paper scissors, lying on the sheet.
//
// Not a button and not an icon: an object in the diorama, made of the same
// stuff as everything else in it and lit by the same light. There is no chrome
// anywhere in this app and this is not where it starts — a toolbar button
// saying "add" would be a different application wearing this one's paper.
//
// It is the only affordance the widget has, which puts a real weight on it: a
// person who has never seen this before has to work out that something can be
// recorded, and the scissors are the whole of the explanation. So they lift
// when the cursor comes near. That is the smallest gesture that says *this one
// is a thing you can pick up* without saying anything at all.
//
// --- and they claim the dwell -----------------------------------------------
//
// Resting the pointer on the box summons a butterfly. Resting it on the
// scissors must not, because the two gestures are the same gesture — hold still
// here — and they share one pointer. Resolving that by timing would be a race;
// resolving it by *place* is a rule. So visit.ts takes a claim predicate and
// this module is what it is registered against: where the scissors are, nobody
// is summoned. See `registerPointerClaim`.
//
// The geometry is built in a local unit space — the whole tool is one unit long,
// the pivot is the origin — and mapped into css px by one function. Nothing here
// uses ctx.scale, because canvas shadow offsets and blurs do not travel through
// a transform, and a scissors whose shadow scaled with the sheet and whose blur
// did not would be the sort of bug that only shows up on someone else's monitor.

import { lightVector, strokeCutEdge, type Rect } from "./paper";
import { paperStock, rgba, type Stock } from "./papers";
import type { Knob } from "./tuning-panel";

export const SCISSORS = {
  // Where it lies, as fractions of the sheet. Bottom left: out of the way of
  // the swarm, out from under the tuning panel, and clear of the row of folded
  // squares that accumulates along the bottom.
  atX: 0.14,
  atY: 0.84,
  length: 0.22, // of the sheet's width, tip of blade to back of handle
  angleDeg: -24, // lying at an angle, blades pointing up and to the right
  openDeg: 9, // how far ajar. a closed pair reads as a knife

  // Noticing the cursor. `reach` is measured from the tool's own footprint, so
  // it is a halo rather than a radius from a point.
  reach: 34,
  lift: 3.4, // css px it rises, and the same again in shadow
  liftSec: 0.15,

  shadowBlur: 2.6,
  shadowDrop: 1.8,
  shadowAlpha: 0.34,

  blade: "#9aa2a6", // 鈍色 — a cool grey stock
  handle: "#5f7086", // 藍鼠 — indigo, the same family as the heavens paper
};

// The tool's footprint in local units, for the hit test and the halo. Generous
// on purpose: this is a 60px object and the claim it makes on the pointer
// should be a little larger than the paper, not a little smaller.
const FOOTPRINT = { minX: -0.54, minY: -0.3, maxX: 0.64, maxY: 0.3 };

let lift = 0;

/** How far the scissors have risen, 0 lying flat and 1 fully lifted. */
export function scissorsLift(): number {
  return lift;
}

/**
 * Is this point on the scissors?
 *
 * Registered twice over in main.ts: once with visit.ts, so no butterfly is
 * summoned here, and once with input.ts, so pressing the scissors is a click on
 * them rather than the start of a window drag.
 */
export function scissorsHit(x: number, y: number, sheet: Rect): boolean {
  const p = toLocal(x, y, sheet);
  return (
    p.x >= FOOTPRINT.minX && p.x <= FOOTPRINT.maxX && p.y >= FOOTPRINT.minY && p.y <= FOOTPRINT.maxY
  );
}

/**
 * One frame of noticing the pointer.
 *
 * Eased, exponentially, like everything else that moves — a lift that snapped
 * would read as a hover state on a control rather than as an object answering a
 * hand. `cursor` is null when the pointer has left the window, and the scissors
 * settle back down.
 */
export function stepScissors(dt: number, cursor: { x: number; y: number } | null, sheet: Rect): void {
  const want = cursor && distanceTo(cursor.x, cursor.y, sheet) <= SCISSORS.reach ? 1 : 0;
  const k = dt <= 0 ? 0 : 1 - Math.exp(-dt / Math.max(0.01, SCISSORS.liftSec));
  lift += (want - lift) * k;
  if (Math.abs(want - lift) < 0.002) lift = want;
}

/** Tests, and mode changes: put them back down without a frame. */
export function resetScissors(): void {
  lift = 0;
}

// --- where it lies -----------------------------------------------------------

function scaleOf(sheet: Rect): number {
  return Math.max(12, sheet.w * SCISSORS.length);
}

/**
 * The pivot, in css px. Where the blank slip is cut from, and therefore where
 * it comes forward out of — a slip that simply faded in at the front of the box
 * would have come from nowhere.
 */
export function scissorsAt(sheet: Rect): { x: number; y: number } {
  return originOf(sheet);
}

function originOf(sheet: Rect): { x: number; y: number } {
  return { x: sheet.x + sheet.w * SCISSORS.atX, y: sheet.y + sheet.h * SCISSORS.atY };
}

// Local unit space -> css px. Rotate, scale, translate, and raise by the lift.
// The lift moves the paper toward the light, because a thing picked up off a
// table moves toward whatever is above it.
function mapper(sheet: Rect): (x: number, y: number) => { x: number; y: number } {
  const s = scaleOf(sheet);
  const o = originOf(sheet);
  const a = (SCISSORS.angleDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const L = lightVector();
  const rise = lift * SCISSORS.lift;
  return (x, y) => ({
    x: o.x + (x * cos - y * sin) * s + L.x * rise,
    y: o.y + (x * sin + y * cos) * s + L.y * rise,
  });
}

function toLocal(x: number, y: number, sheet: Rect): { x: number; y: number } {
  const s = scaleOf(sheet);
  const o = originOf(sheet);
  const a = (-SCISSORS.angleDeg * Math.PI) / 180;
  const dx = (x - o.x) / s;
  const dy = (y - o.y) / s;
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
}

// css px from the point to the tool's footprint, zero inside it.
function distanceTo(x: number, y: number, sheet: Rect): number {
  const p = toLocal(x, y, sheet);
  const dx = Math.max(FOOTPRINT.minX - p.x, 0, p.x - FOOTPRINT.maxX);
  const dy = Math.max(FOOTPRINT.minY - p.y, 0, p.y - FOOTPRINT.maxY);
  return Math.hypot(dx, dy) * scaleOf(sheet);
}

// --- the shape ---------------------------------------------------------------
//
// One limb is a blade, a shank and a ring handle, all in a line through the
// pivot at the origin. The pair is one limb mirrored in y, and each is then
// swung about the pivot so the tool sits ajar — a closed pair of scissors reads
// as a knife, and this one has to say at a glance what it is for.

interface Pt {
  x: number;
  y: number;
}

type Map2 = (x: number, y: number) => Pt;

function quad(a: Pt, c: Pt, b: Pt, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({
      x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    });
  }
  return out;
}

function ellipse(cx: number, cy: number, rx: number, ry: number, rot: number, n: number, reverse: boolean): Pt[] {
  const out: Pt[] = [];
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const a = ((reverse ? -i : i) / n) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    out.push({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos });
  }
  return out;
}

// Swing a limb about the pivot, and mirror it for the other side.
function limbSpace(side: 1 | -1): (p: Pt) => Pt {
  const a = (side * SCISSORS.openDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return (p) => {
    const y = p.y * side;
    return { x: p.x * cos - y * sin, y: p.x * sin + y * cos };
  };
}

// The cutting edge runs almost straight along the axis; the back bulges. That
// asymmetry is the whole silhouette of a blade, and it is what stops this
// reading as a pair of leaves.
function bladePoints(): Pt[] {
  const back = quad({ x: 0.02, y: 0.03 }, { x: 0.2, y: 0.108 }, { x: 0.58, y: 0.013 }, 12);
  const edge = quad({ x: 0.58, y: 0.013 }, { x: 0.28, y: 0.002 }, { x: 0.02, y: 0.004 }, 8);
  return [...back, ...edge];
}

function shankPoints(): Pt[] {
  const outer = quad({ x: 0.03, y: 0.03 }, { x: -0.12, y: 0.055 }, { x: -0.3, y: 0.13 }, 8);
  const inner = quad({ x: -0.3, y: 0.075 }, { x: -0.12, y: 0.014 }, { x: 0.03, y: 0.0 }, 8);
  return [...outer, ...inner];
}

function ringOuter(): Pt[] {
  return ellipse(-0.38, 0.128, 0.16, 0.115, 0.42, 26, false);
}

function ringInner(): Pt[] {
  return ellipse(-0.38, 0.128, 0.098, 0.066, 0.42, 26, true);
}

function polyPath(points: Pt[], through: (p: Pt) => Pt, P: Map2): Path2D {
  const path = new Path2D();
  points.forEach((raw, i) => {
    const q = through(raw);
    const p = P(q.x, q.y);
    if (i === 0) path.moveTo(p.x, p.y);
    else path.lineTo(p.x, p.y);
  });
  path.closePath();
  return path;
}

function limbPath(side: 1 | -1, P: Map2): { whole: Path2D; blade: Path2D } {
  const to = limbSpace(side);
  const blade = polyPath(bladePoints(), to, P);
  const whole = new Path2D();
  whole.addPath(blade);
  whole.addPath(polyPath(shankPoints(), to, P));
  whole.addPath(polyPath(ringOuter(), to, P));
  // wound the other way, so the nonzero fill punches the finger hole
  whole.addPath(polyPath(ringInner(), to, P));
  return { whole, blade };
}

// --- drawing -----------------------------------------------------------------

export function drawScissors(ctx: CanvasRenderingContext2D, sheet: Rect): void {
  const P = mapper(sheet);
  const scale = scaleOf(sheet);
  const L = lightVector();
  const blade = paperStock(SCISSORS.blade);
  const handle = paperStock(SCISSORS.handle);

  const lower = limbPath(-1, P);
  const upper = limbPath(1, P);
  const both = new Path2D();
  both.addPath(lower.whole);
  both.addPath(upper.whole);

  // The cast shadow, which is most of what the lift is. A thing lifted off a
  // table does not get bigger; its shadow gets further away and softer, and
  // that is the whole cue.
  const rise = 1 + scissorsLift() * 1.9;
  ctx.save();
  ctx.shadowColor = rgba([32, 24, 16], SCISSORS.shadowAlpha);
  ctx.shadowBlur = SCISSORS.shadowBlur * rise;
  ctx.shadowOffsetX = -L.x * SCISSORS.shadowDrop * rise + 2000;
  ctx.shadowOffsetY = -L.y * SCISSORS.shadowDrop * rise;
  ctx.translate(-2000, 0); // paint the caster off-canvas; the offset returns the shadow
  ctx.fillStyle = "#000";
  ctx.fill(both);
  ctx.restore();

  const edge = { width: Math.max(0.5, scale * 0.012), offset: Math.max(0.4, scale * 0.009) };

  drawLimb(ctx, lower, blade, handle, edge, scale, P, -1);
  // the upper limb is a second layer of paper and says so, exactly as a
  // forewing does over a hindwing
  ctx.save();
  ctx.clip(lower.whole);
  ctx.translate(-L.x * 1.1, -L.y * 1.1);
  ctx.fillStyle = rgba(blade.dark, 0.3);
  ctx.fill(upper.whole);
  ctx.restore();
  drawLimb(ctx, upper, blade, handle, edge, scale, P, 1);

  // the pivot: a small disc of the handle stock, with a shadowed eye
  const pivot = polyPath(ellipse(0, 0, 0.045, 0.045, 0, 18, false), (p) => p, P);
  ctx.fillStyle = rgba(handle.body);
  ctx.fill(pivot);
  strokeCutEdge(ctx, pivot, rgba(handle.lit, 0.7), rgba(handle.dark, 0.7), edge.width, edge.offset);
  const eye = polyPath(ellipse(0, 0, 0.016, 0.016, 0, 12, false), (p) => p, P);
  ctx.fillStyle = rgba(handle.dark, 0.75);
  ctx.fill(eye);
}

function drawLimb(
  ctx: CanvasRenderingContext2D,
  limb: { whole: Path2D; blade: Path2D },
  blade: Stock,
  handle: Stock,
  edge: { width: number; offset: number },
  scale: number,
  P: Map2,
  side: 1 | -1,
): void {
  // Handle stock under the whole limb, blade stock over the blade alone: two
  // papers glued together, which is what a pair of scissors is.
  ctx.fillStyle = rgba(handle.base);
  ctx.fill(limb.whole);
  ctx.fillStyle = rgba(blade.base);
  ctx.fill(limb.blade);

  // The sharpened bevel, a pale line along the cutting edge. The one detail
  // that says *blade* rather than *grey leaf*, and it is worth the six lines.
  const to = limbSpace(side);
  ctx.save();
  ctx.clip(limb.blade);
  ctx.lineWidth = Math.max(0.5, scale * 0.018);
  ctx.strokeStyle = rgba(blade.lit, 0.85);
  ctx.beginPath();
  const edgeLine = quad({ x: 0.6, y: 0.012 }, { x: 0.3, y: 0.004 }, { x: 0.04, y: 0.006 }, 8);
  edgeLine.forEach((raw, i) => {
    const q = to(raw);
    const p = P(q.x, q.y);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();
  ctx.restore();

  strokeCutEdge(ctx, limb.whole, rgba(blade.lit, 0.8), rgba(blade.dark, 0.6), edge.width, edge.offset);
}

// --- the panel's view of all this --------------------------------------------

export function scissorsKnobs(): Knob[] {
  const S = SCISSORS as unknown as Record<string, number>;
  const knob = (key: string, min: number, max: number, step: number): Knob => ({
    group: "scissors",
    label: key,
    min,
    max,
    step,
    get: () => S[key],
    set: (v) => {
      S[key] = v;
    },
  });

  return [
    knob("atX", 0, 1, 0.005),
    knob("atY", 0, 1, 0.005),
    knob("length", 0.05, 0.6, 0.005),
    knob("angleDeg", -180, 180, 1),
    knob("openDeg", 0, 30, 0.5),
    knob("reach", 0, 120, 1),
    knob("lift", 0, 14, 0.1),
    knob("liftSec", 0.02, 1, 0.01),
    knob("shadowBlur", 0, 14, 0.1),
    knob("shadowDrop", 0, 10, 0.1),
    knob("shadowAlpha", 0, 1, 0.01),
  ];
}
