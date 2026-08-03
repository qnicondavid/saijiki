// Emergence. The square unfolds.
//
// CLAUDE.md: "The folded square stays a square until the widget is next opened
// on a *later day*. Then it unfolds into a butterfly. This is the only thing in
// the app that ever asks the user to return, and it asks by promising rather
// than demanding. Never notify about it. Never expire it — however long they
// take, the birth is waiting."
//
// Everything here follows from the second half of that. It is the one moment
// the app has that is worth coming back for, so it is the one moment that gets
// spent on: a beat of stillness, three creases opening, a pause lying flat, and
// then it goes. And because it asks by promising, it takes nothing at all if
// nobody is looking — no sound, no text, no flash, nothing that outlives being
// missed. Miss it and you have a butterfly, which is what you were promised.
// Watch it and you saw where it came from.
//
// --- it unfolds, it does not appear ------------------------------------------
//
// The animation is record.ts's fold run backwards: the same three creases, in
// the same order, taken from the same list — see `FOLDS` there, which is
// exported for exactly this reason. A square that dissolved into a butterfly
// would be two pictures with a fade between them. A square that *opens* is one
// piece of paper the whole way through, which is the only version of this that
// is true.
//
// The paper is drawn as the creature from the first frame, and that matters
// more than it sounds. The packet is not a wrapper with a butterfly inside it,
// it is the butterfly folded up — so the punched cuts and the wing pattern are
// already there, quartered and reflected, before anything moves. It also means
// the last frame of the unfold and the first frame of the climb are the same
// call to the same renderer for the same cached tile. The creature is never
// handed from one drawing to another, so there is nothing to make match.
//
// The last crease to come undone is the vertical one down the middle of the
// slip, which is the mountain fold the whole creature is built on. So the final
// movement of the unfold is the left wing coming out from behind the right one.
// That is not an effect arranged to look like one; it is what three folds of a
// 2:1 slip leaves you holding.

import { deriveButterfly, type ButterflySpec, type Pt } from "./butterfly";
import { NEAR, POSE_BEAT, poseOpen, renderButterfly } from "./butterfly-render";
import { chrysalisIndex, chrysalisTilt, slotAt } from "./chrysalis";
import { FLIGHT, enterFlightAt } from "./flight";
import { stream } from "./noise";
import { strokeCutEdge, type Rect } from "./paper";
import { paletteFor, rgba, type Category, type Palette } from "./papers";
import { FOLDS, afterFolds } from "./record";
import type { Knob } from "./tuning-panel";
import { VISIT } from "./visit";

export const EMERGE = {
  // The four beats. The two that do nothing are doing the most: a square that
  // began opening the instant it was looked at would be a thing reacting to
  // being seen, and a creature that left the moment it was flat would be a
  // transition rather than a birth.
  waitSec: 0.85, // it lies there
  unfoldSec: 1.3, // three creases
  restSec: 0.55, // flat, and still
  riseSec: 1.6, // up off the floor and back into the box

  // Between one starting and the next. Longer than the wait and the unfold put
  // together, so no two are ever opening at once — several days away is a queue,
  // not a hatch. One is still climbing while the next begins, which makes it a
  // stagger rather than a line.
  gapSec: 2.9,

  // How wide the slip is when it is flat, as a fraction of the sheet's width.
  // About twice a butterfly at the glass, because the floor at the front of the
  // box is nearer than anything flying in it. That is also what makes the climb
  // read as going *into* the box rather than across it: it recedes to its proper
  // size on the way, on the same perspective the five planes already run on.
  span: 0.16,

  // Where it lets go, as fractions of the near plane's rect. A band rather than
  // a point, and the point inside it is off the id — a birth that always ended
  // in the same place would be a machine.
  releaseX: [0.2, 0.8] as [number, number],
  releaseY: [0.15, 0.55] as [number, number],

  arc: 0.35, // how far the climb bows sideways, in fractions of its own width
  spin: 14, // ± degrees it turns through on the way up
  beatFrom: 0.42, // how far up the climb the wings stop opening and start beating

  backAlpha: 0.92, // how solidly the reverse of a fold hides what is under it
};

/** What emergence needs of a kigo: the creature, its paper, and how pale it is. */
export interface Hatchling {
  id: string;
  category: Category;
  /** Its saturation, so a square the clock has bleached opens bleached. */
  fade: number;
}

export type Beat = "waiting" | "unfolding" | "resting" | "rising";

interface Hatching {
  id: string;
  spec: ButterflySpec;
  palette: Palette;
  /** Its place in the row of squares, so it opens where it was lying. */
  slot: number;
  /** Seconds on its own clock. Negative while it is still queued. */
  t: number;
  /** Where it let go, in css px. Handed to flight, so the two cannot disagree. */
  releaseAt: { x: number; y: number } | null;
  /** The near plane it is climbing into. Kept so the climb cannot leave it. */
  field: Rect | null;
}

const hatching: Hatching[] = [];

/**
 * Put these in the queue.
 *
 * Called with whoever stopped being a square since the widget was last looked
 * at — one entry on an ordinary morning, and possibly several after a few days
 * away. They are staggered rather than hatched together: the ceremony is worth
 * watching once, and four at once is a weather effect.
 *
 * The stagger runs from the end of the queue rather than from now, so calling
 * this twice — a scrub, then another scrub — appends instead of overlapping.
 */
export function hatch(list: readonly Hatchling[]): void {
  if (list.length === 0) return;
  const gap = Math.max(0.2, EMERGE.gapSec);
  let next = 0;
  for (const one of hatching) next = Math.max(next, -one.t + gap);

  list.forEach((one, i) => {
    if (hatching.some((h) => h.id === one.id)) return;
    // Where it is lying. A square already in the row keeps its place; one that
    // was on the floor when the widget was closed — nobody has drawn that row
    // this run — takes the place it would have had.
    const known = chrysalisIndex(one.id);
    hatching.push({
      id: one.id,
      spec: deriveButterfly(one.id),
      palette: paletteFor(one.category, one.fade),
      slot: known >= 0 ? known : i,
      t: -next,
      releaseAt: null,
      field: null,
    });
    next += gap;
  });
}

/** Is this one in the middle of being born? Then it is not in the swarm yet. */
export function isHatching(id: string): boolean {
  return hatching.some((h) => h.id === id);
}

export function hatchingCount(): number {
  return hatching.length;
}

/** One line for F9: how many are queued, and how far the front one has got. */
export function emergenceStatus(): string {
  if (hatching.length === 0) return "hatch: —";
  const front = hatching.reduce((a, b) => (a.t > b.t ? a : b));
  const at = beatOf(front.t);
  return `hatch: ${hatching.length} · ${front.id} ${at.beat} ${at.u.toFixed(2)}`;
}

/** A mode change, a test, starting over. Nobody is left half-born. */
export function clearHatching(): void {
  hatching.length = 0;
}

/**
 * Where one has got to, as a beat and how far through it.
 *
 * Exported because it is the only part of this that can be checked without
 * eyes. The shape moving is not the part that goes wrong; the order and the
 * arithmetic are.
 */
export function beatOf(t: number): { beat: Beat; u: number; done: boolean } {
  const E = EMERGE;
  const wait = Math.max(0, E.waitSec);
  const unfold = Math.max(0.05, E.unfoldSec);
  const rest = Math.max(0, E.restSec);
  const rise = Math.max(0.05, E.riseSec);
  if (t < wait) return { beat: "waiting", u: wait <= 0 ? 1 : t / wait, done: false };
  if (t < wait + unfold) return { beat: "unfolding", u: (t - wait) / unfold, done: false };
  if (t < wait + unfold + rest) {
    return { beat: "resting", u: rest <= 0 ? 1 : (t - wait - unfold) / rest, done: false };
  }
  const u = (t - wait - unfold - rest) / rise;
  return { beat: "rising", u: u < 1 ? u : 1, done: u >= 1 };
}

// --- the frame ---------------------------------------------------------------

/**
 * One frame.
 *
 * `bounds` is the near plane's rect — where the swarm at the glass is allowed
 * to be — because that is where a thing recorded a day ago belongs, and it is
 * where this hands its creature over. `onDone` fires once per hatchling, after
 * flight has been told where the creature is standing, so the butterfly that
 * appears is the one that was climbing a frame ago rather than a fresh one
 * somewhere else in the box.
 */
export function stepEmergence(
  dt: number,
  sheet: Rect,
  bounds: Rect,
  onDone: (id: string) => void,
): void {
  if (dt <= 0 || hatching.length === 0) return;
  const finished: string[] = [];
  for (const one of hatching) {
    one.t += dt;
    const at = beatOf(one.t);
    if (at.beat === "rising" && one.releaseAt === null) {
      one.releaseAt = releaseFor(one, bounds);
      one.field = { ...bounds };
    }
    if (at.done) {
      enterFlightAt(one.id, one.releaseAt ?? flatOrigin(one, sheet));
      finished.push(one.id);
    }
  }
  for (const id of finished) {
    const at = hatching.findIndex((h) => h.id === id);
    if (at >= 0) hatching.splice(at, 1);
    onDone(id);
  }
}

/**
 * Where in the near plane it lets go.
 *
 * Off the id, so the same kigo is always born into the same corner of the box.
 * Nobody will ever notice, and it means this is a fact about the creature
 * rather than a dice roll the second time it is watched. A salt of its own, so
 * that adding it moved no gene of any existing butterfly — see `stream`.
 */
function releaseFor(one: Hatching, bounds: Rect): { x: number; y: number } {
  const r = stream(one.id, 0x13);
  const [x0, x1] = EMERGE.releaseX;
  const [y0, y1] = EMERGE.releaseY;
  return {
    x: bounds.x + bounds.w * (x0 + (x1 - x0) * r()),
    y: bounds.y + bounds.h * (y0 + (y1 - y0) * r()),
  };
}

// --- where the paper is ------------------------------------------------------
//
// Everything below works in *slip space*: the flat slip lies centred on the
// origin, `slip.w` across and half that tall, with the creature fitted inside
// it. Three folds of that land on a square of side slip.w / 4 in its
// bottom-right corner, and that square is what the row of chrysalides has been
// drawing all along. So the packet is anchored on its slot by that square's
// centre, and the paper opens out of it up and to the left, which is where the
// room is.

interface Paper {
  slip: Rect;
  /** css px per unit of the creature — its wingspan, in other words. */
  span: number;
  /** the creature's origin in slip space, placing its extent on the slip's centre */
  ox: number;
  oy: number;
  /** the folded square's centre in slip space */
  cx: number;
  cy: number;
}

function paperFor(spec: ButterflySpec, sheet: Rect): Paper {
  const slipW = Math.max(16, sheet.w * EMERGE.span);
  const slipH = slipW / 2;
  const e = spec.extent;
  // Fitted rather than assumed. The wingspan is one unit, but the extent takes
  // in the antennae too, and a creature that did not fit would show as paper
  // sticking out of the sides of its own folded square.
  const span = Math.min(slipW / (e.maxX - e.minX), slipH / (e.maxY - e.minY));
  return {
    slip: { x: -slipW / 2, y: -slipH / 2, w: slipW, h: slipH, r: 0 },
    span,
    ox: -((e.minX + e.maxX) / 2) * span,
    oy: -((e.minY + e.maxY) / 2) * span,
    cx: slipW / 4,
    cy: slipH / 4,
  };
}

/** Where the flat creature's own origin ends up, in css px. */
function flatOrigin(one: Hatching, sheet: Rect): { x: number; y: number } {
  const slot = slotAt(one.slot, sheet);
  const paper = paperFor(one.spec, sheet);
  return { x: slot.x - paper.cx + paper.ox, y: slot.y - paper.cy + paper.oy };
}

// --- the leaves --------------------------------------------------------------
//
// Folded paper is the same sheet in several places at once. A leaf is one of
// those places: an axis-aligned reflection, or a composition of them, saying
// where a point of the flat slip has ended up after n folds. Three folds make
// eight of them, and every one is a flip in x, a flip in y, or both — so a leaf
// is four numbers and never a matrix.
//
// `flips` decides which side of the paper is showing. Even is the face; odd is
// the reverse, which is blank. A fold shows you the *back* of the flap, not a
// mirror of its front, and drawing the mirror is the single most common way to
// get folded paper wrong.

interface Leaf {
  sx: 1 | -1;
  tx: number;
  sy: 1 | -1;
  ty: number;
  flips: number;
}

const FLAT: Leaf = { sx: 1, tx: 0, sy: 1, ty: 0, flips: 0 };

function leavesAfter(slip: Rect, folds: number): Leaf[] {
  let leaves: Leaf[] = [FLAT];
  for (let i = 0; i < folds; i++) {
    const base = afterFolds(slip, i);
    const axis = FOLDS[i];
    const crease = axis === "v" ? base.x + base.w / 2 : base.y + base.h / 2;
    leaves = leaves.flatMap((leaf) => [leaf, reflect(leaf, axis, crease)]);
  }
  // Later folds lie on top of earlier ones, and every flip is one more flap
  // closed over whatever was under it. For three folds of a slip that ordering
  // is exactly the stacking order, and it is what puts the backs on top.
  return leaves.sort((a, b) => a.flips - b.flips);
}

function reflect(leaf: Leaf, axis: "v" | "h", crease: number): Leaf {
  const flips = leaf.flips + 1;
  return axis === "v"
    ? { sx: -leaf.sx as 1 | -1, tx: 2 * crease - leaf.tx, sy: leaf.sy, ty: leaf.ty, flips }
    : { sx: leaf.sx, tx: leaf.tx, sy: -leaf.sy as 1 | -1, ty: 2 * crease - leaf.ty, flips };
}

// --- drawing -----------------------------------------------------------------

/**
 * The whole queue.
 *
 * Drawn after the swarm and before the slip: a birth is at the front of the box
 * for as long as it lasts, in the same place a butterfly that has come to the
 * cursor is, and for the same reason — it has left the wall and come forward.
 */
export function drawEmergence(ctx: CanvasRenderingContext2D, sheet: Rect, dpr: number): void {
  for (const one of hatching) {
    if (one.t < 0) continue; // still queued: not even lying there yet
    const at = beatOf(one.t);
    if (at.beat === "rising") drawRising(ctx, one, sheet, at.u, dpr);
    else drawFolded(ctx, one, sheet, at.beat === "waiting" ? 0 : at.beat === "resting" ? 1 : ease(at.u), dpr);
  }
}

/**
 * The packet, `open` of the way from folded to flat.
 *
 * This is record.ts's `drawFolding` with the parameter running the other way,
 * deliberately close to it line for line: the same base, still, flap and crease,
 * the same swing, the same shadow across the half being lifted off, the same
 * edge-on darkening. What is different is what the paper has printed on it, and
 * that is the whole of the difference between folding a blank slip and
 * unfolding a creature.
 */
function drawFolded(
  ctx: CanvasRenderingContext2D,
  one: Hatching,
  sheet: Rect,
  open: number,
  dpr: number,
): void {
  const paper = paperFor(one.spec, sheet);
  const slot = slotAt(one.slot, sheet);

  // Which crease is coming undone — the last one made is the first one
  // opened — and how far, as record.ts's own fold parameter counting down. The
  // two halves of this ceremony are the same motion in opposite directions.
  const scaled = Math.min(FOLDS.length, Math.max(0, open) * FOLDS.length);
  const undone = Math.min(FOLDS.length - 1, Math.floor(scaled));
  const stage = FOLDS.length - 1 - undone;
  const p = 1 - Math.min(1, scaled - undone);

  // The packet begins at the size the row draws it and reaches the slip's own
  // quarter by the time it is flat. A drift of a few px over a second, under a
  // shape that is quadrupling: invisible, and it is what lets the square in the
  // row and the first frame of this be the same object in the same place.
  const k = lerp(slot.size / Math.max(1, paper.slip.w / 4), 1, open);

  ctx.save();
  ctx.translate(slot.x, slot.y);
  ctx.rotate(chrysalisTilt(one.id) * (1 - open)); // the fold put this on; the unfold takes it off
  ctx.scale(k, k);
  ctx.translate(-paper.cx, -paper.cy);

  const base = afterFolds(paper.slip, stage);
  const axis = FOLDS[stage];
  const still: Rect =
    axis === "v"
      ? { x: base.x + base.w / 2, y: base.y, w: base.w / 2, h: base.h, r: 0 }
      : { x: base.x, y: base.y + base.h / 2, w: base.w, h: base.h / 2, r: 0 };
  const flap: Rect =
    axis === "v"
      ? { x: base.x, y: base.y, w: base.w / 2, h: base.h, r: 0 }
      : { x: base.x, y: base.y, w: base.w, h: base.h / 2, r: 0 };
  const crease = axis === "v" ? base.x + base.w / 2 : base.y + base.h / 2;
  const leaves = leavesAfter(paper.slip, stage);

  // the half that stays put
  ctx.save();
  clipTo(ctx, still);
  paint(ctx, one, paper, leaves, dpr, false);
  ctx.restore();

  // the flap's shadow, thrown across the half it is lifting off
  const shade = Math.sin(Math.PI * p);
  if (shade > 0.01) {
    ctx.save();
    clipTo(ctx, still);
    const grad =
      axis === "v"
        ? ctx.createLinearGradient(crease, 0, crease + still.w * 0.8, 0)
        : ctx.createLinearGradient(0, crease, 0, crease + still.h * 0.8);
    grad.addColorStop(0, rgba(one.palette.dark, 0.42 * shade));
    grad.addColorStop(1, rgba(one.palette.dark, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(still.x, still.y, still.w, still.h);
    ctx.restore();
  }

  // The flap itself. It is drawn in the place it occupies when open and then
  // swung about the crease by a scale from +1 to -1, which is what a rigid
  // half-turn about that line looks like from straight on — and this is a paper
  // diorama seen from straight on. Past halfway it has turned over, so the same
  // paper is showing its reverse, which is `turned`.
  const spread = Math.abs(1 - 2 * p);
  if (spread > 0.004) {
    ctx.save();
    if (axis === "v") {
      ctx.translate(crease, 0);
      ctx.scale(1 - 2 * p, 1);
      ctx.translate(-crease, 0);
    } else {
      ctx.translate(0, crease);
      ctx.scale(1, 1 - 2 * p);
      ctx.translate(0, -crease);
    }
    clipTo(ctx, flap);
    paint(ctx, one, paper, leaves, dpr, p > 0.5);
    // edge-on, the paper takes almost no light at all
    ctx.fillStyle = rgba([26, 19, 12], 0.5 * shade);
    ctx.fillRect(flap.x - 4, flap.y - 4, flap.w + 8, flap.h + 8);
    ctx.restore();
  }

  ctx.restore();
}

/**
 * Paper, in as many places at once as it has been folded into.
 *
 * A leaf showing its face is the creature itself — the same renderer, the same
 * cached tile, the same everything the swarm uses — because the packet *is* the
 * creature and the pattern punched through it does not wait for the fold to come
 * out. A leaf showing its reverse is blank stock in the shape of what is behind
 * it, which is what the back of a piece of paper looks like.
 *
 * Each leaf brings its own cast shadow with it, baked into its tile, and the
 * clip cuts it to the fold. That is where the packet's depth comes from: not
 * one shadow under the whole thing, but layers of paper shadowing each other,
 * which is what CLAUDE.md means by depth in the first place.
 */
function paint(
  ctx: CanvasRenderingContext2D,
  one: Hatching,
  paper: Paper,
  leaves: readonly Leaf[],
  dpr: number,
  turned: boolean,
): void {
  const flip = turned ? 1 : 0;
  for (const leaf of leaves) {
    ctx.save();
    ctx.transform(leaf.sx, 0, 0, leaf.sy, leaf.tx, leaf.ty);
    if ((leaf.flips + flip) % 2 === 0) {
      renderButterfly(
        ctx,
        one.spec,
        one.palette,
        paper.ox,
        paper.oy,
        paper.span,
        dpr,
        poseOpen(Math.max(1, Math.round(VISIT.steps))),
        NEAR,
      );
    } else {
      back(ctx, one, paper);
    }
    ctx.restore();
  }
}

/** The reverse of the paper: the same silhouette, a shade deeper, and blank. */
function back(ctx: CanvasRenderingContext2D, one: Hatching, paper: Paper): void {
  const path = silhouetteOf(one.spec, paper);
  ctx.fillStyle = rgba(one.palette.body, EMERGE.backAlpha);
  ctx.fill(path);
  strokeCutEdge(
    ctx,
    path,
    rgba(one.palette.lit, 0.7),
    rgba(one.palette.dark, 0.5),
    Math.max(0.4, paper.span * 0.022),
    Math.max(0.3, paper.span * 0.015),
  );
}

/**
 * The creature laid flat, as one closed region — the shape of its own hole.
 *
 * Panels at their unfolded angle, where butterfly-render's projection is the
 * identity, because this is the shape the piece had while it was still part of
 * the sheet. holes.ts draws the same outline from the same panels, which is the
 * point: what unfolds here and what is missing from the back wall are one shape.
 */
function silhouetteOf(spec: ButterflySpec, paper: Paper): Path2D {
  const path = new Path2D();
  const add = (poly: Pt[]) => {
    const sub = new Path2D();
    poly.forEach((p, i) => {
      const px = paper.ox + p.x * paper.span;
      const py = paper.oy + p.y * paper.span;
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

function clipTo(ctx: CanvasRenderingContext2D, r: Rect): void {
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
}

// --- the climb ---------------------------------------------------------------

/**
 * Up off the floor and back into the box.
 *
 * Three things happen at once and they are all the same fact: it shrinks, its
 * shadow tightens, and its wings come up. It shrinks because it is going *away* —
 * the floor at the front of the box is the nearest thing in the picture and the
 * near plane is behind it.
 *
 * The wings walk the landing ramp *downwards*. A butterfly that comes to the
 * cursor opens flat by climbing that ramp; this is a creature that was already
 * flat, closing into a wingbeat. Same rungs, same tiles, nothing new cached, and
 * the pose it arrives on is the one flight would have drawn for it anyway.
 */
function drawRising(
  ctx: CanvasRenderingContext2D,
  one: Hatching,
  sheet: Rect,
  u: number,
  dpr: number,
): void {
  const from = flatOrigin(one, sheet);
  const to = one.releaseAt ?? from;
  const paper = paperFor(one.spec, sheet);
  const k = ease(u);

  // A climb bows: up before across. Which way it leans is off the id, like
  // everything else about the creature.
  //
  // The bow is held inside the plane it is climbing into. Without that, a
  // creature born in a corner and leaning outward can be carried clean off the
  // paper for half a second — the arc is a fraction of the distance travelled,
  // and the distance travelled can be most of the box.
  const lean = (stream(one.id, 0x14)() - 0.5) * 2;
  const across = Math.abs(to.x - from.x) + paper.slip.w * 0.3;
  const bow = Math.sin(Math.PI * k) * across * EMERGE.arc * lean;
  const field = one.field;
  const x = field
    ? clamp(lerp(from.x, to.x, k) + bow, field.x, field.x + field.w)
    : lerp(from.x, to.x, k) + bow;
  const y = lerp(from.y, to.y, k * k * (3 - 2 * k));
  const scale = lerp(paper.span, FLIGHT.wingspan, k);

  const rungs = Math.max(1, Math.round(VISIT.steps));
  const beats = Math.max(2, Math.round(FLIGHT.beat.phases));
  const into = Math.max(0.01, EMERGE.beatFrom);
  // Down the ramp, then into the beat it will be flying with. The changeover is
  // at the ramp's bottom rung, which *is* the glide pose, which is where flight
  // holds its wings — so it is the same picture twice and never a step.
  const pose =
    u < into
      ? poseOpen(rungs * (1 - u / into))
      : POSE_BEAT + (Math.floor(((u - into) / Math.max(0.01, 1 - into)) * beats * 1.5) % beats);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(((EMERGE.spin * Math.PI) / 180) * lean * Math.sin(Math.PI * k));
  renderButterfly(ctx, one.spec, one.palette, 0, 0, scale, dpr, pose, NEAR);
  ctx.restore();
}

// --- the panel's view of all this --------------------------------------------

export function emergenceKnobs(): Knob[] {
  const E = EMERGE as unknown as Record<string, number>;
  const knob = (key: string, min: number, max: number, step: number): Knob => ({
    group: "emergence",
    label: key,
    min,
    max,
    step,
    get: () => E[key],
    set: (v) => {
      E[key] = v;
    },
  });

  return [
    knob("waitSec", 0, 4, 0.05),
    knob("unfoldSec", 0.2, 5, 0.05),
    knob("restSec", 0, 3, 0.05),
    knob("riseSec", 0.2, 5, 0.05),
    knob("gapSec", 0.2, 12, 0.1),
    knob("span", 0.05, 0.5, 0.005),
    knob("arc", 0, 1.5, 0.02),
    knob("spin", 0, 60, 1),
    knob("beatFrom", 0.05, 1, 0.01),
    knob("backAlpha", 0, 1, 0.01),
  ];
}

export function emergenceConfigJson(): string {
  return `// src/emergence.ts — replaces EMERGE\n${JSON.stringify(EMERGE, null, 2)}\n`;
}

// --- small maths -------------------------------------------------------------

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function ease(t: number): number {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return u * u * (3 - 2 * u);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
