// Coming to the cursor. The dwell, the approach, the landing, the reading, and
// the way home.
//
// This was inside flight.ts and is out here because it is a different kind of
// thing. flight.ts is a simulation — a hundred and fifty small objects with no
// opinion about the pointer, stepped sixty times a second. This is a state
// machine with one occupant, driven by a hand. They share a frame and nothing
// else, and the file that runs the swarm should not also be the file that
// decides what a person meant by holding still.
//
// --- why a dwell ------------------------------------------------------------
//
// touch is the app's only verb. A butterfly on the back plane is thirteen
// pixels across and moving, and asking someone to hit that would be a cruel
// joke — so it comes to them instead.
//
// The asking is a dwell rather than a hover, because the box is small and the
// cursor crosses it all day on its way somewhere else: a hover would mean a
// creature peeling off the swarm every time someone reached for the taskbar,
// which is a parade and, worse, an obligation. Coming to rest is a different
// gesture from passing through, and it is the only one this answers.
//
// `dwellSlop` is how still "rest" means — a hand on a mouse is never quite
// still and a threshold of zero would mean it never triggers.
//
// --- and why it is quantised ------------------------------------------------
//
// `span` is the wingspan when open, and it is large because the words have to
// be readable at 100% zoom without leaning in. It comes forward *out* of its
// plane to get there, which is the same perspective the planes already use:
// nearer is bigger. That is why `steps` exists — the drawn scale is a tile
// cache key, so the journey is quantised onto a fixed ladder of rungs rather
// than minting a fresh sprite sheet every frame of the approach.
//
// --- nothing here reads a clock ---------------------------------------------
//
// `t` is the rAF timestamp the render loop already passes in, so the dwell
// throttles when the widget is unfocused and stops dead when it is hidden,
// exactly like the rest of the motion — which also means a quarter of a second
// is two and a half frames at the unfocused cadence, and still works.

import type { ButterflySpec } from "./butterfly";
import { poseOpen, renderButterfly } from "./butterfly-render";
import type { Rect } from "./paper";
import type { Palette } from "./papers";
import { planeAt, planeLookAt, round2 } from "./planes";
import type { Knob } from "./tuning-panel";
import {
  WING_TEXT,
  drawWingText,
  fontOf,
  layoutWingText,
  type WingTextLayout,
} from "./wing-text";

export const VISIT = {
  dwellSec: 0.25, // how long the cursor must rest before anyone notices
  dwellSlop: 3, // css px of hand tremor that does not count as moving
  approachSec: 0.42, // ease toward the cursor. exponential, so it decelerates
  arrivePx: 1.5,
  span: 190, // wingspan when open, in css px
  openSec: 0.62, // how long the ramp — nearer, larger, opening — takes
  openDeg: 2, // the wings, opened: flat, with just enough lift to catch light
  steps: 10, // rungs on that ramp, and therefore tiles. see the note above
  readAt: 0.62, // how far up the ramp the words start to show through
  leavePx: 28, // move the cursor this far from a landed one and it goes home
  leaveSec: 0.5,
};

/**
 * Where a butterfly is in a visit to the cursor. Separate from a flyer's sleep,
 * because the two are orthogonal: a resting butterfly that is summoned takes off
 * and comes, and a visit ends by handing it back to whatever it was doing.
 */
export type VisitPhase = "none" | "approach" | "alighted" | "leaving";

/**
 * As much of a butterfly as a visit needs.
 *
 * Structural rather than an import, so this module never has to know what else
 * a flyer carries — its wingbeat, its noise lane, whether it is asleep. Those
 * are flight's, and a visit that could reach them would start using them.
 *
 * `rect` is its own plane's box, which is where home is. `depth` and `lookPlane`
 * are read and never written: coming forward to the cursor is not the same as
 * being younger, and the plane a butterfly belongs to must survive being
 * touched.
 */
export interface Visitable {
  id: string;
  spec: ButterflySpec;
  palette: Palette;
  text: string;
  rect: Rect;
  depth: number;
  lookPlane: number;
  x: number;
  y: number;
  heading: number;
  bob: number;
  /**
   * One ramp in [0, 1] carrying three things at once — how near it has come,
   * how large it is drawn, how far its wings have opened — because they are one
   * gesture and splitting them would multiply the tiles by each other.
   */
  visit: VisitPhase;
  visitU: number;
}

// --- the pointer -------------------------------------------------------------

let cursorHere = false;
let cursorX = 0;
let cursorY = 0;

// where the pointer came to rest, and when — the dwell in progress
let dwelling = false;
let dwellX = 0;
let dwellY = 0;
let dwellSince = 0;

let visitor: Visitable | null = null;
// Where it came down. `landX/landY` is where the creature is drawn — the
// pointer, nudged inward near an edge so a creature a third of the sheet across
// is not cut off by the window. `heldX/heldY` is the pointer's own position at
// that moment, and leaving is measured against *that*, because it is what the
// hand is holding.
let landX = 0;
let landY = 0;
let heldX = 0;
let heldY = 0;

/** Where the pointer is, in css px. Called on every move. */
export function setCursor(x: number, y: number): void {
  cursorHere = true;
  cursorX = x;
  cursorY = y;
}

/** The pointer has left the window, or the view has. Ends any visit. */
export function clearCursor(): void {
  cursorHere = false;
  dwelling = false;
}

/** Tests only, and mode changes: forget the pointer and send anyone home. */
export function endVisit(): void {
  clearCursor();
  if (visitor && visitor.visit !== "none") visitor.visit = "leaving";
}

export type PointerClaim = (x: number, y: number) => boolean;

let claimed: PointerClaim = () => false;

/**
 * Something else on the sheet that owns the pointer where it overlaps.
 *
 * The scissors are the first of these, and the rule is theirs: resting the
 * cursor on them summons nobody. Two gestures share one pointer and both are
 * "hold still here", so the ambiguity has to be resolved by *place* rather than
 * by timing — a dwell that summoned a butterfly onto the scissors a moment
 * before the click that opens a slip would be the app arguing with itself.
 *
 * A claimed point is treated exactly as though the pointer were outside the
 * box: no dwell matures there, and anyone already landed goes home. That is the
 * whole of it, and it is why this is one predicate rather than a mode.
 */
export function registerPointerClaim(fn: PointerClaim): void {
  claimed = fn;
}

// --- what is happening -------------------------------------------------------

export interface VisitReport {
  id: string;
  phase: VisitPhase;
  /** 0 at its plane, 1 landed and open. */
  u: number;
  /** the wingspan it is being drawn at, in css px */
  scale: number;
}

/** What is happening at the cursor, for the F9 overlay and for tests. */
export function visitReport(): VisitReport | null {
  if (!visitor) return null;
  return {
    id: visitor.id,
    phase: visitor.visit,
    u: visitor.visitU,
    scale: visitScale(visitor),
  };
}

/** The kigo of a butterfly that has landed and opened, or null. */
export function alightedId(): string | null {
  return visitor && visitor.visit === "alighted" ? visitor.id : null;
}

/**
 * Is this point a press on the landed butterfly?
 *
 * Registered with input.ts, which asks before it lets a press become a window
 * drag: CLAUDE.md is explicit that the whole surface is draggable but that
 * touch must always win. Nothing but a landed butterfly ever claims a press
 * here, so the widget stays draggable from anywhere the rest of the time — a
 * hit test that claimed every butterfly in the box would turn a third of the
 * window into dead space where nothing happens and the widget cannot be moved.
 *
 * The claim is the creature's own footprint, plus a small disc around the
 * pointer's own landing point. The disc matters near the edges, where the
 * butterfly is nudged inward to stay inside the window and the pointer is
 * therefore not quite under the wings it is looking at.
 */
export function hitTest(x: number, y: number): boolean {
  if (!visitor || visitor.visit !== "alighted") return false;
  if (Math.hypot(x - heldX, y - heldY) <= VISIT.leavePx) return true;
  const span = visitScale(visitor);
  const e = visitor.spec.extent;
  return (
    x >= landX + e.minX * span &&
    x <= landX + e.maxX * span &&
    y >= landY + e.minY * span &&
    y <= landY + e.maxY * span
  );
}

// --- the dwell ---------------------------------------------------------------

/**
 * Has anyone been asked for?
 *
 * `flyers` is everyone who could come; `summon` is what it means for flight to
 * call one of its own out of the swarm — waking it if it was asleep and putting
 * it into a glide — which is flight's business and not this module's.
 */
export function stepAttention<T extends Visitable>(
  flyers: readonly T[],
  t: number,
  bounds: Rect,
  summon: (f: T, t: number) => void,
): void {
  // "Inside the sheet" is the mouth of the box — where the swarm is — and not
  // the whole window. Resting the pointer on the box rim is not asking, and
  // neither is resting it on something that has claimed the pointer for itself.
  const inside =
    cursorHere && contains(bounds, cursorX, cursorY) && !claimed(cursorX, cursorY);

  // --- the dwell
  if (!inside) {
    dwelling = false;
  } else if (!dwelling || Math.hypot(cursorX - dwellX, cursorY - dwellY) > VISIT.dwellSlop) {
    dwelling = true;
    dwellX = cursorX;
    dwellY = cursorY;
    dwellSince = t;
  }

  // --- has whoever is here been sent home?
  if (visitor && visitor.visit !== "none" && visitor.visit !== "leaving") {
    const gone =
      !inside ||
      (visitor.visit === "alighted" &&
        Math.hypot(cursorX - heldX, cursorY - heldY) > VISIT.leavePx);
    if (gone) visitor.visit = "leaving";
  }

  // --- and is anyone being asked for?
  if (!visitor && inside && dwelling && t - dwellSince >= VISIT.dwellSec) {
    const chosen = nearestTo(flyers, cursorX, cursorY);
    if (chosen) {
      visitor = chosen;
      chosen.visit = "approach";
      chosen.visitU = 0;
      summon(chosen, t);
    }
    dwelling = false; // one summons per dwell, however long the pointer rests
  }

  if (visitor && visitor.visit === "none") visitor = null;
}

/** Somewhere on the glass, on some plane. The shape `nearest` chooses between. */
export interface Placed {
  x: number;
  y: number;
  plane: number;
}

/**
 * Nearest in screen space, front plane winning ties.
 *
 * Screen space and not plane space: the question is which creature the pointer
 * has come to rest beside, and the eye answers that in pixels. The tie-break is
 * depth, because when two are equally close the nearer one is the one being
 * looked at — it is bigger, sharper and in front of the other, and reaching past
 * it for something on the back wall would read as the box picking wrongly.
 *
 * Pure, and separate from the swarm, because it is the whole of the choice and
 * the only part of a visit that can be got wrong quietly.
 */
export function nearest<T extends Placed>(items: readonly T[], x: number, y: number): T | null {
  const TIE = 0.001; // two floats a thousandth of a pixel apart are the same place
  let best: T | null = null;
  let bestD = Infinity;
  for (const item of items) {
    const d = Math.hypot(item.x - x, item.y - y);
    if (best === null || d < bestD - TIE || (d <= bestD + TIE && item.plane < best.plane)) {
      best = item;
      bestD = Math.min(bestD, d);
    }
  }
  return best;
}

// The bob counts: it is where the creature is drawn, and where it is drawn is
// where it looks like it is.
function nearestTo<T extends Visitable>(flyers: readonly T[], x: number, y: number): T | null {
  const placed = flyers.map((f) => ({ f, x: f.x, y: f.y + f.bob, plane: f.lookPlane }));
  return nearest(placed, x, y)?.f ?? null;
}

/**
 * Whoever was at the cursor may have just left the store. Called after the
 * swarm is reconciled, so a visit is never left holding a butterfly that is no
 * longer in the box.
 */
export function dropVisitorUnless(flyers: readonly Visitable[]): void {
  if (visitor && !flyers.includes(visitor)) visitor = null;
}

// --- the journey -------------------------------------------------------------

/**
 * One frame of a visit.
 *
 * The position eases toward the pointer and the ramp eases toward one, on two
 * different constants and on purpose: the approach is the quicker of the two,
 * so it arrives and *then* finishes opening rather than arriving already open.
 * Both are exponential, which is where the deceleration comes from — nothing
 * here is a curve someone drew, it is the shape of not quite getting there.
 *
 * `glass` is the whole drawable surface rather than the flight bounds, because
 * a butterfly that has come forward to the cursor has *left* the box: it is a
 * third of the sheet across by then, and holding it inside the flight bounds
 * would push it a long way off the pointer near the edges. It is allowed over
 * the box rim, which is what being in front of the box looks like, and not over
 * the edge of the window, where it would be cut in half.
 *
 * Returns true on the frame the visit ends, so the caller knows the butterfly
 * is back in its hands. Returned rather than left to be noticed, because "did
 * `visit` change during that call?" is exactly the kind of thing a caller reads
 * once and then forgets to keep reading.
 */
export function stepVisit(f: Visitable, dt: number, glass: Rect): boolean {
  if (f.visit === "leaving") {
    f.visitU += (0 - f.visitU) * ease(dt, VISIT.leaveSec);
    // back toward its own plane's box, from wherever in the window it had got.
    // Once it is inside, the nearest point inside *is* where it already is, so
    // this quietly stops rather than needing to be told to.
    const home = nearestInside(f.rect, f.x, f.y);
    const k = ease(dt, VISIT.leaveSec);
    f.x += (home.x - f.x) * k;
    f.y += (home.y - f.y) * k;
    // Done when the ramp has nothing left to show: the rung is back at zero, so
    // it is its plane's own size, in its plane's own pose, in its plane's box.
    // Waiting for the ease to reach a true zero would be another second of a
    // butterfly that has already visibly arrived.
    if (visitRung(f) <= 0) {
      f.visitU = 0;
      f.visit = "none";
      f.x = home.x;
      f.y = home.y;
      if (visitor === f) visitor = null;
      return true;
    }
    return false;
  }

  const target = landingPoint(f, glass);
  const k = ease(dt, VISIT.approachSec);
  f.x += (target.x - f.x) * k;
  f.y += (target.y - f.y) * k;
  f.visitU += (1 - f.visitU) * ease(dt, VISIT.openSec);
  const dx = target.x - f.x;
  const dy = target.y - f.y;
  // so that when it leaves it is already pointed somewhere sensible
  if (dx !== 0 || dy !== 0) f.heading = Math.atan2(dy, dx);
  if (f.visit === "approach" && Math.hypot(dx, dy) <= VISIT.arrivePx) {
    f.visit = "alighted";
    heldX = cursorX;
    heldY = cursorY;
  }
  if (f.visit === "alighted") {
    landX = target.x;
    landY = target.y;
  }
  return false;
}

/**
 * Where a visiting butterfly is actually headed.
 *
 * The pointer, nudged just far enough inward that a creature the size of a
 * third of the sheet is not cut in half by the edge of the window. Without it,
 * dwelling in a corner would clip a wing off — and the words with it, which are
 * the entire reason it came. The nudge is small, because the room it is
 * measured against is the whole glass rather than the box: at the shipped size
 * it only bites within about thirty pixels of an edge, and it is invisible
 * anyway, because the pointer is hidden for as long as one is landed. The
 * butterfly is where the cursor is, so it is where the cursor appears to be.
 */
function landingPoint(f: Visitable, glass: Rect): { x: number; y: number } {
  const span = visitSpan(f);
  const e = f.spec.extent;
  const room = {
    x: glass.x - e.minX * span,
    y: glass.y - e.minY * span,
    w: Math.max(0, glass.w - (e.maxX - e.minX) * span),
    h: Math.max(0, glass.h - (e.maxY - e.minY) * span),
    r: 0,
  };
  return nearestInside(room, cursorX, cursorY);
}

function nearestInside(rect: Rect, x: number, y: number): { x: number; y: number } {
  return {
    x: clamp(x, rect.x, rect.x + rect.w),
    y: clamp(y, rect.y, rect.y + rect.h),
  };
}

/** The wingspan a visit ends at: large enough that the line can be read. */
function visitSpan(f: Visitable): number {
  return Math.max(planeAt(f.lookPlane).scale, VISIT.span);
}

/**
 * How far up the ramp this butterfly is, quantised.
 *
 * Everything the visit changes about the *art* — the wingspan, the pose, how
 * much of the plane's haze is left — reads this one number, so the whole
 * journey costs a fixed ladder of tiles rather than a fresh sprite sheet per
 * frame. That is the same bargain depth planes strike, for the same reason:
 * `scale` is part of the cache key, and a continuum in a cache key is a cache
 * that never hits.
 */
function visitRung(f: Visitable): number {
  const steps = Math.max(1, Math.round(VISIT.steps));
  return Math.round(clamp(f.visitU, 0, 1) * steps) / steps;
}

/**
 * The wingspan at that rung. Geometric, like the planes' own ladder.
 *
 * This is the one number that had to be got right rather than merely
 * quantised. A butterfly on the back plane is 13px and the reading size is 190,
 * and interpolating between them evenly makes the first rung a jump of nearly
 * eighty per cent while the last is twelve — so it leaves at a bound and
 * arrives creeping, which is the opposite of an approach. Stepping the *ratio*
 * instead makes every rung the same proportional change, which is what an
 * object coming toward you at a steady speed actually does, and it is the same
 * curve `farScale` uses going the other way.
 */
function visitScale(f: Visitable): number {
  const from = planeAt(f.lookPlane).scale;
  const to = visitSpan(f);
  if (from <= 0) return round2(to);
  return round2(from * Math.pow(to / from, visitRung(f)));
}

// --- drawing -----------------------------------------------------------------

/**
 * The one that has come to the cursor: larger, clearer, and open.
 *
 * All three come off the same quantised rung. The wingspan is interpolated from
 * its plane's toward the reading size, the pose walks the opening ramp, and the
 * plane's haze is undone as it comes forward — because haze is the air between
 * it and the glass, and it is crossing that air.
 */
export function drawVisitor(
  ctx: CanvasRenderingContext2D,
  f: Visitable,
  dpr: number,
): void {
  const u = visitRung(f);
  const scale = visitScale(f);
  renderButterfly(
    ctx,
    f.spec,
    f.palette,
    f.x,
    f.y + f.bob,
    scale,
    dpr,
    poseOpen(u * Math.max(1, Math.round(VISIT.steps))),
    planeLookAt(f.lookPlane, u),
  );

  // The words, as the wings open far enough to have an inside. Drawn over the
  // tile rather than into it: the line is not part of the creature — the seed
  // rule says the geometry comes from the id and nothing else — and a butterfly
  // whose sprite sheet depended on its text would rebuild itself every time a
  // typo was fixed.
  //
  // Fitted once, at the size it will land at, and scaled the rest of the way.
  // The ink is on the paper: it comes nearer with the paper, and it never
  // re-breaks under the reader.
  if (!f.text) return;
  const alpha = smoothstep(VISIT.readAt, 1, f.visitU);
  if (alpha <= 0) return;
  const span = visitSpan(f);
  drawWingText(ctx, layoutFor(f, span, ctx), f.x, f.y + f.bob, alpha, scale / span);
}

// Laid out once per creature rather than per frame: fitting a line costs a
// dozen measurements, and since the layout is made at the landed span and then
// merely scaled, there is exactly one of them per visit.
//
// The reading constants are in the key rather than being a rebuild knob,
// because they change the *words* and nothing else — throwing away a hundred
// and fifty butterflies' sprite sheets to move a line height would be a very
// expensive way to answer a slider.
const layouts = new Map<string, WingTextLayout>();

/** The pose table was rebuilt, so the span a layout was fitted to may have moved. */
export function clearVisitLayouts(): void {
  layouts.clear();
}

function layoutFor(f: Visitable, span: number, ctx: CanvasRenderingContext2D): WingTextLayout {
  const T = WING_TEXT;
  const key = `${f.id}|${span}|${T.width},${T.height},${T.rise},${T.font},${T.line}|${f.text}`;
  let layout = layouts.get(key);
  if (!layout) {
    layout = layoutWingText(f.text, span, (fontPx, s) => {
      ctx.save();
      ctx.font = fontOf(fontPx);
      const w = ctx.measureText(s).width;
      ctx.restore();
      return w;
    });
    if (layouts.size > 64) layouts.clear();
    layouts.set(key, layout);
  }
  return layout;
}

// --- the panel's view of all this --------------------------------------------

/**
 * The visit's constants, and the reading constants that go with them.
 *
 * `steps` and `openDeg` shape the opening ramp, which is part of flight's pose
 * table, so those two rebuild; the rest is timing and distance and is best
 * judged by hovering the box while dragging them.
 *
 * The words are not motion either, but the only place they can be judged is on
 * a butterfly that has just landed — so they belong on the same panel as the
 * thing that brings it.
 */
export function visitKnobs(): Knob[] {
  const V = VISIT as unknown as Record<string, number>;
  const T = WING_TEXT as unknown as Record<string, number>;
  const knob = (
    group: string,
    bag: Record<string, number>,
    key: string,
    min: number,
    max: number,
    step: number,
    rebuild = false,
  ): Knob => ({
    group,
    label: key,
    min,
    max,
    step,
    rebuild,
    get: () => bag[key],
    set: (v) => {
      bag[key] = v;
    },
  });

  return [
    knob("visit", V, "dwellSec", 0, 1.5, 0.01),
    knob("visit", V, "dwellSlop", 0, 20, 0.5),
    knob("visit", V, "approachSec", 0.05, 2, 0.01),
    knob("visit", V, "span", 40, 320, 2),
    knob("visit", V, "openSec", 0.05, 2, 0.01),
    knob("visit", V, "openDeg", -20, 40, 1, true),
    knob("visit", V, "steps", 2, 16, 1, true),
    knob("visit", V, "readAt", 0, 1, 0.01),
    knob("visit", V, "leavePx", 4, 120, 1),
    knob("visit", V, "leaveSec", 0.05, 2, 0.01),

    knob("reading", T, "width", 0.2, 1, 0.01),
    knob("reading", T, "height", 0.1, 0.9, 0.01),
    knob("reading", T, "rise", -0.2, 0.3, 0.005),
    knob("reading", T, "font", 0.03, 0.2, 0.002),
    knob("reading", T, "line", 0.9, 2.2, 0.02),
  ];
}

// --- small maths -------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// How much of the way to close a gap in this frame, exponentially. Frame-rate
// independent, so a throttled widget eases at the same speed a focused one does
// and only in fewer, larger pieces.
function ease(dt: number, sec: number): number {
  return dt <= 0 ? 0 : 1 - Math.exp(-dt / Math.max(0.01, sec));
}

function smoothstep(a: number, b: number, v: number): number {
  const t = clamp(b === a ? 1 : (v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function contains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}
