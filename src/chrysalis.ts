// The folded square, waiting at the bottom of the box.
//
// A kigo that has been recorded but whose day has not yet turned is not a
// butterfly. It is the slip, folded three times, lying on the floor of the box:
// a small square of dyed paper, nothing written on it that anyone can see,
// perfectly still.
//
// CLAUDE.md calls that Emergence, and it is the only thing in the app that ever
// asks the user to return — "and it asks by promising rather than demanding".
// Everything about how this is drawn follows from that sentence. It does not
// pulse, glow, count down, or move. It is not a notification with a paper
// texture on it. It is an object that will be something else tomorrow, and the
// whole of the invitation is that you can see it is folded.
//
// Which squares exist is not stored anywhere: a kigo is folded exactly while
// `hasEmerged` says it is, which is a fact about two dates. So this module is
// handed the list on every clock change and holds no state that can go stale
// except the one square the recording ceremony is still animating — see
// `hideChrysalis`.
//
// The unfolding is step 12. What it will need from here is the slot, which is
// why `chrysalisSlot` is the exported shape rather than an internal detail.

import { stream } from "./noise";
import { lightVector, strokeCutEdge, type Rect } from "./paper";
import { paletteFor, rgba, type Category, type Stock } from "./papers";
import type { Knob } from "./tuning-panel";

export const CHRYSALIS = {
  // The row, in fractions of the sheet. It starts clear of the scissors in the
  // bottom-left corner and marches right. In real use there is one square, very
  // occasionally two — entries are rare — so the row is a rule for a rare case
  // rather than a layout to be admired.
  fromX: 0.34,
  atY: 0.88,
  size: 0.058, // of the sheet's width
  gap: 0.028,

  tilt: 7, // ± degrees, per square, off its own id
  shadowBlur: 2.4,
  shadowDrop: 1.6,
  shadowAlpha: 0.34,
  creaseAlpha: 0.38,
};

export interface Folded {
  id: string;
  category: Category;
}

let folded: readonly Folded[] = [];
let hidden: string | null = null;

/** Everyone whose day has not turned yet, in the order the store lists them. */
export function setChrysalides(list: readonly Folded[]): void {
  folded = list;
}

/**
 * One square the ceremony is still carrying, and which must therefore not also
 * be lying in the row.
 *
 * The entry is written to disk before the slip has finished folding, which is
 * the right order — the writing is what makes it real and the animation is what
 * makes it visible — but it does mean that for about a second the saijiki holds
 * a kigo whose square is still in the air. Without this it would be drawn
 * twice, in two places, and the ceremony would end by revealing that it had
 * been a trick.
 */
export function hideChrysalis(id: string | null): void {
  hidden = id;
}

export function chrysalisCount(): number {
  return folded.length;
}

/**
 * Where this one lies, in css px, or null if it is not folded.
 *
 * A pure function of its place in the row, so the settling animation can aim at
 * exactly the spot the row will draw it, and hand over without a jump.
 */
export function chrysalisSlot(id: string, sheet: Rect): { x: number; y: number; size: number } | null {
  const index = folded.findIndex((f) => f.id === id);
  if (index < 0) return null;
  const size = Math.max(6, sheet.w * CHRYSALIS.size);
  const step = size + sheet.w * CHRYSALIS.gap;
  return {
    x: sheet.x + sheet.w * CHRYSALIS.fromX + index * step,
    y: sheet.y + sheet.h * CHRYSALIS.atY,
    size,
  };
}

/**
 * How far this square lies askew, in radians.
 *
 * A row of perfectly square squares is a spreadsheet. Off the id, so it never
 * moves, and exported because the recording ceremony folds a slip *into* this
 * square and has to arrive at the same angle — a hand-off that computed the
 * number twice is a hand-off waiting to disagree with itself.
 */
export function chrysalisTilt(id: string): number {
  return ((stream(id, 0x12)() - 0.5) * 2 * CHRYSALIS.tilt * Math.PI) / 180;
}

export function drawChrysalides(ctx: CanvasRenderingContext2D, sheet: Rect): void {
  for (const one of folded) {
    if (one.id === hidden) continue;
    const slot = chrysalisSlot(one.id, sheet);
    if (!slot) continue;
    drawFoldedSquare(ctx, one.id, paletteFor(one.category), slot.x, slot.y, slot.size, 0);
  }
}

/**
 * A square of folded paper, centred on (x, y).
 *
 * Shared with the recording ceremony, which spends a second folding a slip down
 * to exactly this and then stops drawing — so this has to be the same picture
 * from both sides, or the hand-off shows.
 *
 * `lift` is how far off the floor it is, 0 lying flat. The settling square uses
 * it on the way down; a square in the row is always 0, because nothing here
 * ever moves again until it hatches.
 */
export function drawFoldedSquare(
  ctx: CanvasRenderingContext2D,
  id: string,
  stock: Stock,
  x: number,
  y: number,
  size: number,
  lift: number,
): void {
  const tilt = chrysalisTilt(id);
  const L = lightVector();
  const half = size / 2;

  const path = new Path2D();
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  const corner = (dx: number, dy: number) => ({
    x: x + (dx * cos - dy * sin),
    y: y + (dx * sin + dy * cos),
  });
  const corners = [corner(-half, -half), corner(half, -half), corner(half, half), corner(-half, half)];
  corners.forEach((p, i) => (i === 0 ? path.moveTo(p.x, p.y) : path.lineTo(p.x, p.y)));
  path.closePath();

  const rise = 1 + lift * 2.4;
  ctx.save();
  ctx.shadowColor = rgba([32, 24, 16], CHRYSALIS.shadowAlpha);
  ctx.shadowBlur = CHRYSALIS.shadowBlur * rise;
  ctx.shadowOffsetX = -L.x * CHRYSALIS.shadowDrop * rise + 2000;
  ctx.shadowOffsetY = -L.y * CHRYSALIS.shadowDrop * rise;
  ctx.translate(-2000, 0); // the caster goes off-canvas; the offset returns the shadow
  ctx.fillStyle = "#000";
  ctx.fill(path);
  ctx.restore();

  ctx.fillStyle = rgba(stock.base);
  ctx.fill(path);

  // The layers inside. Three folds made this out of a slip twice as wide as it
  // was tall — left over right, top over bottom, left over right again — which
  // leaves creases along the left and top edges and loose cut edges along the
  // right and bottom. What shows is the edge of the layer beneath, just inside
  // those two, and that is the whole difference between a folded square and a
  // square: two sides you could get a fingernail into and two you could not.
  ctx.save();
  ctx.clip(path);
  ctx.lineWidth = Math.max(0.5, size * 0.04);
  const inset = half * 0.6;
  const layer = (a: { x: number; y: number }, b: { x: number; y: number }, colour: string) => {
    ctx.strokeStyle = colour;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };
  layer(corner(inset, -half), corner(inset, half), rgba(stock.dark, CHRYSALIS.creaseAlpha));
  layer(corner(-half, inset), corner(half, inset), rgba(stock.dark, CHRYSALIS.creaseAlpha * 0.8));
  ctx.restore();

  strokeCutEdge(
    ctx,
    path,
    rgba(stock.lit, 0.85),
    rgba(stock.dark, 0.6),
    Math.max(0.5, size * 0.05),
    Math.max(0.4, size * 0.035),
  );
}

// --- the panel's view of all this --------------------------------------------

export function chrysalisKnobs(): Knob[] {
  const C = CHRYSALIS as unknown as Record<string, number>;
  const knob = (key: string, min: number, max: number, step: number): Knob => ({
    group: "chrysalis",
    label: key,
    min,
    max,
    step,
    get: () => C[key],
    set: (v) => {
      C[key] = v;
    },
  });

  return [
    knob("fromX", 0, 1, 0.005),
    knob("atY", 0, 1, 0.005),
    knob("size", 0.02, 0.2, 0.002),
    knob("gap", 0, 0.1, 0.002),
    knob("tilt", 0, 30, 0.5),
    knob("shadowBlur", 0, 12, 0.1),
    knob("shadowDrop", 0, 8, 0.1),
    knob("shadowAlpha", 0, 1, 0.01),
    knob("creaseAlpha", 0, 1, 0.01),
  ];
}
