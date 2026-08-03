// Flight. Separate memories that happen to share a box.
//
// The word the constitution uses is "individuals", and every choice here is a
// choice against unison. Unison is the single most artificial-looking failure
// mode available to a swarm: a box of wings on one beat reads as a screensaver
// within about four seconds, and no amount of pretty geometry recovers from it.
// So beat phase and beat rate are per-creature, the drift field each one wanders
// is its own slice of noise, and its decisions and glides and naps are drawn
// against its own stream.
//
// It is also, explicitly, NOT flocking. There is no alignment and no cohesion —
// only separation, and weakly. Boids would give a lovely school of fish and
// exactly the wrong idea: these are separate things a person started doing, not
// a shoal with an opinion.
//
// And a third of them are asleep at any moment. A whole saijiki beating at once
// is exhausting to sit next to, and this has to be liveable for eight hours
// rather than impressive for eight seconds.
//
// --- what is *not* here ---------------------------------------------------
//
// Heading. A butterfly does not turn to face where it is going, because the
// pre-rendered tile bakes its cast shadow and its fold shading against a fixed
// light and a vertical fold, and rotating the blit would swing both. Drifting
// cut paper is the honest reading of that constraint and, in a paper diorama,
// the better-looking one. If it ever needs to bank, the tile has to carry the
// rotation, not the blit.
//
// The plane model. Which plane a kigo's age puts it on, what that plane looks
// like and how a butterfly travels between them is planes.ts, and it is separate
// because it is a table and some arithmetic with no frame in it — this module is
// the one that runs sixty times a second.
//
// The visit. Coming to the cursor — the dwell, the approach, the landing, the
// words on the opened wings — is visit.ts. It lived here and does not any more,
// because it is a different kind of thing: a state machine with one occupant,
// driven by a hand, where this is a simulation of a hundred and fifty objects
// with no opinion about the pointer. A flyer that has been summoned drops out of
// everything below and is handed over whole; all this file keeps of it is that
// it is elsewhere, so the swarm does not sleep it, shove it, or avoid it.
//
// --- and where the swarm comes from ----------------------------------------
//
// One butterfly per kigo, and no butterflies at all when there are no kigo.
// There is no filler, no demo creature, no "at least show something": the empty
// state is the pristine sheet from step 2, and it is meant to be lovely on its
// own for the first several months of real use.
//
// A flyer's geometry comes from its kigo's id and its colour from its category
// and its fade — the two inputs a butterfly's look has, and deliberately
// separate. Its *flight* is seeded off the id too, so a kigo drifts the same way
// across restarts and re-filing it under another category recolours it without
// changing how it moves.

import { BUTTERFLY, deriveButterfly, type ButterflySpec } from "./butterfly";
import {
  POSE_BEAT,
  POSE_GLIDE,
  POSE_REST,
  renderButterfly,
  setWingPoses,
  type WingPose,
} from "./butterfly-render";
import { fbm, hashString, mulberry32 } from "./noise";
import { sheetRect, type Rect } from "./paper";
import {
  boundsAt,
  easeDepth,
  planeAt,
  planeCount,
  planeKnobs,
  planeOf,
  planeSize,
  planeTable,
  setNearPlane,
  PLANES,
  type NearPlane,
} from "./planes";
import { paletteFor, type Category, type Palette } from "./papers";
import { bucketsSince, saturationFor, seasonsSince, type DateLike } from "./seasons";
import type { Knob } from "./tuning-panel";
import {
  VISIT,
  clearVisitLayouts,
  drawVisitor,
  dropVisitorUnless,
  stepAttention,
  stepVisit,
  visitKnobs,
  type VisitPhase,
} from "./visit";
import { WING_TEXT } from "./wing-text";

const TAU = Math.PI * 2;
const rad = (deg: number) => (deg * Math.PI) / 180;

// --- the one config object -------------------------------------------------
//
// Everything the motion does is a number in here, and every number in here has
// a slider. Tune by dragging, then paste the dump back over this object.
//
// Nothing derived from these is cached on a butterfly at birth — a flyer stores
// its *jitter*, a fixed number in [-1, 1], and multiplies it by the current
// spread every frame. That is what lets `hz` and `hzSpread` take effect on a
// swarm that is already in the air instead of on the next one.

export const FLIGHT = {
  // `count` used to live here. It does not any more: the swarm is however many
  // kigo there are, which is zero on the first day and a hundred and fifty
  // against the seeded dev store. A slider for it would be a slider for how much
  // of someone's diary to draw.
  wingspan: 26, // css px at the glass. every plane behind it is a fraction of this

  // Depth is planes.ts — the table, its look, and the journey between planes.
  // Its constants have their own home there and their own sliders, spliced into
  // this panel by `flightKnobs`.

  // The wingbeat. These are the constants that change what is *drawn*, so
  // moving one rebuilds the sprite sheet — hence `rebuild` on their knobs.
  beat: {
    phases: 12, // sprite sheet depth. more is smoother and costs tiles
    hz: 2.3,
    hzSpread: 0.55, // ± fraction of hz, per butterfly
    upDeg: 62, // top of the stroke: wings lifted toward the viewer
    downDeg: -24, // bottom: pressed back toward the sheet
    glideDeg: 6, // held open through a glide
    restDeg: -11, // settled: the shallow mountain fold of a specimen
    hindAmp: 0.72, // the hindwing beats shallower than the forewing
    hindLag: 0.09, // and trails it, in fractions of a beat
    skew: 0.38, // downstroke quicker than the recovery. 0 is a pure sine
    camera: 3.4, // viewer distance in wingspans; smaller splays a lifted wing more
  },

  // Wandering. Smooth noise steers the heading; it does not shove the position,
  // which is the difference between a butterfly and a dust mote.
  drift: {
    speed: 11, // css px/sec at cruise
    speedSpread: 0.35,
    scale: 0.55, // noise units per second. smaller = longer, lazier arcs
    turn: 2.6, // rad/sec at full deflection of the drift field
    ease: 2.2, // how briskly speed reaches its target
  },

  // Decisions. The drift field alone reads as weather; a butterfly that
  // occasionally commits to a new direction reads as a butterfly.
  decide: {
    rate: 0.22, // decisions per second, exponentially spaced
    turnDeg: 85,
    sec: 0.55, // how long the swing takes
  },

  // Glides. The wings hold open and it coasts.
  glide: {
    rate: 0.16, // glides per second
    minSec: 0.6,
    maxSec: 2.2,
    speed: 0.55, // fraction of cruise carried through the hold
  },

  // The bob rides the wingbeat, slightly behind it — a wing pushes air before
  // the body answers.
  bob: {
    amp: 2.2, // css px
    phase: 0.22, // fraction of a beat behind the wings
    ease: 3.5, // how fast the bob fades in and out of a glide
  },

  // Soft repulsion from the sheet's edges. `turn` makes it change its mind
  // before it gets there; `push` is the backstop that means it never clips the
  // frame even if it was heading straight at one.
  edge: { margin: 26, turn: 3.4, push: 34 },

  // Weak mutual avoidance. Separation only — see the header.
  avoid: { radius: 30, turn: 2.4, push: 10 },

  // How many are asleep. Settled on the sheet, wings still, waking occasionally
  // and taking off while others land.
  rest: {
    fraction: 0.35,
    wakeRate: 0.03, // per resting butterfly per second
    landRate: 0.1, // per flying butterfly per second, while below the target
    settleSec: 1.1, // how long the glide down to a stop takes
  },

  // Coming to the cursor is visit.ts, and so are its constants. Its knobs are
  // spliced into this panel by `flightKnobs`, the same arrangement planes.ts
  // has, and for the same reason: two objects, one panel.
};

// --- the wingbeat, quantised ----------------------------------------------

let phaseCount = FLIGHT.beat.phases;
let glideEntryU = 0;

/**
 * Where in the beat the wings are passing through the glide angle. A hold that
 * begins anywhere else begins with a jerk, so a butterfly that has decided to
 * glide waits until its wings arrive at the right place — which is at most one
 * beat away, and reads as intent rather than delay.
 */
export function glideEntry(): number {
  return glideEntryU;
}

// In [-1, 1]. The phase warp is what makes the downstroke quicker than the
// recovery; a pure sine spends equal time in both and reads as a metronome.
function beatWave(u: number, skew: number): number {
  return Math.sin(TAU * (u + (skew / TAU) * Math.sin(TAU * u)));
}

function foreAngle(u: number): number {
  const B = FLIGHT.beat;
  const t = (beatWave(wrap01(u), B.skew) + 1) / 2;
  return rad(B.downDeg + (B.upDeg - B.downDeg) * t);
}

/**
 * The pose table, exported whole so it can be inspected without a canvas.
 * The hindwing is derived from the forewing rather than given its own curve:
 * same shape, shallower, and late.
 *
 * `open` is the ramp a butterfly walks as it comes in to land: from the glide
 * angle it was holding to flat, where both inner surfaces face the viewer and
 * the writing on them can be read. It starts *exactly* at the glide pose so
 * that stepping onto the ramp is not a step at all, and it ends a couple of
 * degrees short of flat, because two panels at precisely zero read as a print
 * rather than as an opened fold.
 */
export function poseTable(): {
  rest: WingPose;
  glide: WingPose;
  beat: WingPose[];
  open: WingPose[];
} {
  const B = FLIGHT.beat;
  const n = Math.max(2, Math.round(B.phases));
  const mid = rad((B.downDeg + B.upDeg) / 2);
  const beat: WingPose[] = [];
  for (let i = 0; i < n; i++) {
    const u = i / n;
    beat.push({
      fore: foreAngle(u),
      hind: mid + (foreAngle(u - B.hindLag) - mid) * B.hindAmp,
    });
  }

  const rungs = Math.max(1, Math.round(VISIT.steps));
  const open: WingPose[] = [];
  for (let i = 0; i <= rungs; i++) {
    const deg = lerp(B.glideDeg, VISIT.openDeg, i / rungs);
    open.push({ fore: rad(deg), hind: rad(deg) * B.hindAmp });
  }

  return {
    rest: { fore: rad(B.restDeg), hind: rad(B.restDeg) * B.hindAmp },
    glide: { fore: rad(B.glideDeg), hind: rad(B.glideDeg) * B.hindAmp },
    beat,
    open,
  };
}

/** Rebuild the sprite sheet's poses and hand them to the renderer. */
export function rebuildFlightPoses(): void {
  const table = poseTable();
  phaseCount = table.beat.length;

  // the phase whose wings sit closest to the glide angle, so entering a hold
  // costs at most the gap between two sprite frames
  const target = rad(FLIGHT.beat.glideDeg);
  let best = 0;
  let bestErr = Infinity;
  for (let i = 0; i < table.beat.length; i++) {
    const err = Math.abs(table.beat[i].fore - target);
    if (err < bestErr) {
      bestErr = err;
      best = i;
    }
  }
  glideEntryU = best / table.beat.length;

  setWingPoses(table.rest, table.glide, table.beat, table.open, FLIGHT.beat.camera);
  setNearPlane(nearPlane());
  clearVisitLayouts();
}

/**
 * What the plane table is measured back from. The three numbers belong to the
 * glass — the wingspan, the full wingbeat tile count, the resting fraction —
 * and they live here rather than in planes.ts because they are the near end of
 * a recession, not the far one.
 */
function nearPlane(): NearPlane {
  return {
    scale: FLIGHT.wingspan,
    phases: Math.max(2, Math.round(FLIGHT.beat.phases)),
    rest: FLIGHT.rest.fraction,
  };
}

// Handed over at load rather than waiting for initFlight, so that a test which
// never starts a frame still reads a plane table built from the constants above
// instead of planes.ts's own copy of them.
setNearPlane(nearPlane());

// --- flyers ----------------------------------------------------------------

// "landing" here means settling onto the sheet to sleep. Landing on the
// *cursor* is a VisitPhase, and the two are orthogonal — see visit.ts.
type FlyerState = "flying" | "landing" | "resting";

/**
 * A kigo, as much of it as flight needs: which creature to cut, which paper to
 * cut it from, when it began, and when it was last known to be true.
 *
 * `created` and `since` are the two dates and they drive the two channels.
 * `created` is immutable and sets the depth plane; `since` is the last touch,
 * or the created date for a kigo that has never been touched — an entry was
 * true on the day it was written, so that is where the fading starts counting
 * from. A kigo that is touched moves in colour and never in depth, which is the
 * point: touching says *still true*, not *begun again*.
 */
export interface SwarmEntry {
  id: string;
  category: Category;
  created: DateLike;
  since: DateLike;
  /**
   * The one line, for the inner surface of the wings. Optional because flight
   * is perfectly happy without it — nothing in the air reads it, and it appears
   * only on a butterfly that has landed on the cursor and opened.
   */
  text?: string;
}

interface Flyer {
  id: string;
  spec: ButterflySpec;
  palette: Palette;
  rng: () => number;

  // How long ago this kigo was recorded, in buckets. Kept raw rather than
  // resolved to a plane at birth, so the depth sliders reach a swarm that is
  // already in the air — the same reason `hzJitter` is a jitter and not an hz.
  bucketsAgo: number;
  // Eased, continuous. The integer nearest it is the plane whose art is drawn;
  // the fractional value is where its box is, so a plane change is a short
  // glide inward or outward rather than a jump. Rounding is what keeps the tile
  // cache key discrete while the movement stays smooth.
  depth: number;
  lookPlane: number;
  // Its own plane's flight bounds. Mutated in place, never reallocated: this is
  // touched once per butterfly per frame.
  rect: Rect;

  x: number;
  y: number;
  heading: number;
  speed: number;

  // fixed in [-1, 1]; multiplied by the live spread every frame so the sliders
  // reach butterflies that are already flying
  hzJitter: number;
  speedJitter: number;

  beatU: number;
  wanderT: number;
  wanderRow: number; // this creature's own lane through the drift field
  noiseSeed: number;

  decideAt: number;
  turnRate: number;
  turnUntil: number;

  gliding: boolean;
  wantsGlide: boolean;
  glideUntil: number;
  glideAt: number;

  state: FlyerState;
  landUntil: number;

  bobAmp: number; // eased, so a glide does not freeze the bob at an offset
  bob: number;

  // The visit — visit.ts's two fields, and the whole of what this file knows
  // about one. `depth` is deliberately not among them: coming forward to the
  // cursor is not the same as being younger, and the plane a butterfly belongs
  // to must survive being touched.
  visit: VisitPhase;
  visitU: number;
  // The one line, for the inner surface of the wings. Carried rather than read:
  // nothing in the air shows it, and a butterfly that has landed and opened is
  // the only place in the app it ever appears.
  text: string;
}

interface Member {
  id: string;
  palette: Palette;
  bucketsAgo: number;
  text: string;
}

const flyers: Flyer[] = [];
const specs = new Map<string, ButterflySpec>();
let roster: Member[] = [];
let rosterChanged = true;
let order: Flyer[] = [];

function specFor(id: string): ButterflySpec {
  let s = specs.get(id);
  if (!s) {
    s = deriveButterfly(id);
    specs.set(id, s);
  }
  return s;
}

/** Set up the pose table. Call once, before the first frame. */
export function initFlight(): void {
  rebuildFlightPoses();
}

/**
 * Who is in the box, and how much colour each of them has left.
 *
 * Called once when the store has loaded, and again every time the clock moves —
 * which is what makes scrubbing visible: the same butterflies, in the same
 * places, doing the same things, with the dye drained out of them. So this
 * reconciles by id rather than rebuilding: a flyer that is still in the roster
 * keeps its position, its heading, its beat phase and whether it is asleep, and
 * only its paper changes. Rebuilding would scatter the swarm on every keypress
 * and make the colour change impossible to see against the movement.
 *
 * The fade is `saturationFor(seasonsSince(...))` and nothing else. Five discrete
 * levels, computed here rather than in the renderer, so the palette — and
 * therefore the tile cache key — takes one of forty values however many kigo
 * there are.
 *
 * Depth is the other half of the same call. It is `bucketsSince(created, ...)`
 * and nothing else, and it is deliberately computed from a different date than
 * the fade: the two channels have to be able to disagree, because the mixed
 * cases are the interesting ones. Both are recomputed here on every clock
 * change, which is what makes scrubbing move the colour *and* the depth without
 * moving anything else.
 */
export function setSwarm(entries: readonly SwarmEntry[], today: DateLike): void {
  roster = entries.map((entry) => ({
    id: entry.id,
    palette: paletteFor(entry.category, saturationFor(seasonsSince(entry.since, today))),
    bucketsAgo: bucketsSince(entry.created, today),
    text: entry.text ?? "",
  }));
  rosterChanged = true;
}

/**
 * Where the swarm is allowed to be at the glass: the sheet, not the window.
 * `reservedRight` takes the tuning panel's footprint off the right-hand side so
 * the whole swarm stays where it can be judged.
 *
 * This is plane zero's rect and the mouth of the box. Every plane behind it is
 * this one, narrowed.
 */
export function flightBounds(cssW: number, cssH: number, reservedRight = 0): Rect {
  const s = sheetRect(cssW, cssH);
  const inset = FLIGHT.wingspan * 0.55 + 2;
  return {
    x: s.x + inset,
    y: s.y + inset,
    w: Math.max(24, s.w - inset * 2 - reservedRight),
    h: Math.max(24, s.h - inset * 2),
    r: 0,
  };
}

export function restingCount(): number {
  let n = 0;
  for (const f of flyers) if (f.state !== "flying") n++;
  return n;
}

export function flyerCount(): number {
  return flyers.length;
}

// CLAUDE.md's five steps, in order. Five and not more: this is the whole set of
// saturations any butterfly can be at, and therefore the whole set of palettes
// the tile cache has to hold.
const FADE_STEPS: readonly number[] = [0, 1, 2, 3, 4].map(saturationFor);

/**
 * How many butterflies are at each step of the fade, full colour first.
 *
 * On the F9 overlay, because "scrubbing forward drains colour" is a claim about
 * a hundred and fifty small moving objects and the eye is not a good instrument
 * for it. Watching `65 · 32 · 27 · 0 · 26` slide rightwards as the seasons are
 * scrubbed is — and it also shows, in a way the picture cannot, that the swarm
 * was recoloured rather than rebuilt.
 */
export function swarmFade(): number[] {
  const out = FADE_STEPS.map(() => 0);
  for (const f of flyers) {
    const step = FADE_STEPS.indexOf(f.palette.saturation);
    if (step >= 0) out[step]++;
  }
  return out;
}

/**
 * How many butterflies are on each plane, glass first.
 *
 * The companion to `swarmFade`, and for the same reason: "scrubbing forward
 * steps the swarm back a plane" is a claim about a hundred and fifty small
 * objects that the eye cannot count. Watching `12 · 5 · 26 · 39 · 68` shift
 * rightwards on `}` and back on `{` is the proof the model is wired to the
 * clock, and a run of zeroes in the middle of it is the proof the edges are
 * wrong — which is exactly how CLAUDE.md's one-bucket-per-plane model was
 * measured and moved off.
 *
 * Counts the plane actually being *drawn*, not the target, so a swarm caught
 * mid-ease reads as mid-ease.
 */
export function swarmDepth(): number[] {
  const out = new Array(planeCount()).fill(0);
  for (const f of flyers) out[clamp(f.lookPlane, 0, out.length - 1)]++;
  return out;
}

/**
 * How many tiles this swarm needs to hold every pose of every creature on the
 * plane it is on.
 *
 * The number the F9 overlay's `tiles:` line is racing toward, available before
 * it gets there. Every butterfly cycles its whole phase set inside one wingbeat,
 * so a cache that cannot hold all of this holds none of it — and unlike the
 * eviction counter, this says so a second before the first frame rather than
 * after the jank starts.
 */
export function swarmWorkingSet(counts: readonly number[] = swarmDepth()): number {
  const table = planeTable();
  let tiles = 0;
  for (let p = 0; p < counts.length && p < table.length; p++) {
    tiles += counts[p] * (table[p].phases + 2); // the beat, plus rest and glide
  }
  return tiles;
}

// --- the step --------------------------------------------------------------

// Per-plane tallies, sized to the plane count and reused. Five numbers, but
// they are rebuilt every frame and this module is the one that runs all day.
let planeTotal: number[] = [];
let planeAsleep: number[] = [];
let planeTarget: number[] = [];

/**
 * One frame.
 *
 * `bounds` is the mouth of the box — where the swarm flies. `glass` is the
 * whole drawable surface, and it is a second rect because a butterfly that has
 * come forward to the cursor has *left* the box: it is a third of the sheet
 * across by then, and holding it inside the flight bounds would push it a long
 * way off the pointer near the edges. It is allowed over the box rim, which is
 * what being in front of the box looks like, and not over the edge of the
 * window, where it would be cut in half. Defaults to the bounds, which is what
 * a caller with no opinion should get.
 */
export function stepFlight(dt: number, t: number, bounds: Rect, glass: Rect = bounds): void {
  reconcile(bounds);
  settleDepth(dt, bounds);
  stepAttention(flyers, t, bounds, callOut);

  const n = planeCount();
  if (planeTotal.length !== n) {
    planeTotal = new Array(n).fill(0);
    planeAsleep = new Array(n).fill(0);
    planeTarget = new Array(n).fill(0);
  }
  planeTotal.fill(0);
  planeAsleep.fill(0);
  for (const f of flyers) {
    planeTotal[f.lookPlane]++;
    if (f.state !== "flying") planeAsleep[f.lookPlane]++;
  }
  if (dt <= 0) return;

  const R = FLIGHT.rest;
  const table = planeTable();
  // The resting fraction rises with depth, so the target is per plane rather
  // than per swarm. That is not only calmer — it is where the visual noise
  // would be worst, because the far planes are the crowded ones and a hundred
  // small things all beating at the back of a box is a static field.
  for (let p = 0; p < n; p++) {
    planeTarget[p] = Math.round(clamp(table[p].rest, 0, 1) * planeTotal[p]);
  }

  for (const f of flyers) {
    // A butterfly that has been summoned is out of the ordinary economy
    // entirely: it does not sleep, it is not pushed off the edges of a box it
    // has left, and it is going somewhere rather than wandering. All this file
    // still owes it is the bob, which is the body answering the wings and
    // therefore motion rather than visiting.
    if (f.visit !== "none") {
      const home = stepVisit(f, dt, glass);
      calmBob(f, dt);
      // Home again, and back in the swarm's economy. The glide it came in on
      // ends here rather than expiring on a schedule set before it left.
      if (home) f.gliding = false;
      continue;
    }

    const p = f.lookPlane;
    if (f.state === "resting") {
      // A resting butterfly wakes on its own schedule. The one exception is a
      // target that has just been dragged downward: without a nudge the swarm
      // would take a minute to answer a slider, and "changes apply instantly"
      // is the whole point of the panel.
      const eager = planeAsleep[p] > planeTarget[p] ? 6 : 1;
      if (f.rng() < R.wakeRate * eager * dt) {
        takeOff(f, t);
        planeAsleep[p]--;
      }
      continue;
    }

    if (f.state === "flying" && planeAsleep[p] < planeTarget[p] && f.rng() < R.landRate * dt) {
      f.state = "landing";
      f.landUntil = t + R.settleSec;
      planeAsleep[p]++;
    }

    stepFlyer(f, dt, t, f.rect);
  }
}

/**
 * Move every butterfly toward the plane its age says it is on, and put it in
 * that plane's box.
 *
 * Runs even on a zero-length frame, because it is also what places a newborn
 * and what answers a window resize. Three things happen here and the split
 * between them is the whole transition:
 *
 *   · `depth` eases toward the target plane. Exponential, so it is frame-rate
 *     independent and arrives without a stop.
 *   · The *rect* follows `depth` continuously, and a butterfly whose rect has
 *     moved is remapped proportionally inside it. That is what makes a scrub
 *     read as the whole swarm stepping backwards together: the box it is
 *     wandering in shrinks and carries it inward. It is also what absorbs a
 *     window resize, which is the same operation and used to have its own pass.
 *   · The *art* follows `Math.round(depth)`, so scale, wingbeat tiles, haze and
 *     shadow flip once, at the halfway point of the journey — the moment the
 *     creature is moving fastest and a size step is least visible. Easing those
 *     continuously would make `scale` a continuum again and put one sprite
 *     sheet per butterfly per frame through the cache, which is the exact thing
 *     depth planes exist to prevent.
 *
 * A butterfly away visiting the cursor still does all of this — its plane is
 * its age and a visit does not change its age — but it is not remapped into its
 * rect, because it is deliberately outside it.
 */
function settleDepth(dt: number, bounds: Rect): void {
  const last = planeCount() - 1;
  for (const f of flyers) {
    const target = clamp(planeOf(f.bucketsAgo), 0, last);
    f.depth = easeDepth(f.depth, target, dt);
    f.lookPlane = clamp(Math.round(f.depth), 0, last);

    const prevX = f.rect.x;
    const prevY = f.rect.y;
    const prevW = f.rect.w;
    const prevH = f.rect.h;
    boundsAt(f.rect, bounds, f.depth);
    if (f.visit !== "none") continue;
    if (f.rect.x !== prevX || f.rect.y !== prevY || f.rect.w !== prevW || f.rect.h !== prevH) {
      const u = prevW > 0 ? (f.x - prevX) / prevW : 0.5;
      const v = prevH > 0 ? (f.y - prevY) / prevH : 0.5;
      f.x = f.rect.x + clamp(u, 0, 1) * f.rect.w;
      f.y = f.rect.y + clamp(v, 0, 1) * f.rect.h;
    }
  }
}

function stepFlyer(f: Flyer, dt: number, t: number, bounds: Rect): void {
  const B = FLIGHT.beat;
  const D = FLIGHT.drift;

  // How big this creature is on screen, as a fraction of one at the glass.
  // Continuous rather than the drawn plane's scale, so nothing about the motion
  // steps at the same instant the art does.
  //
  // Everything measured in screen px is multiplied by it — speed, the edge
  // margin, the avoidance radius, the bob. Distance shrinks apparent motion as
  // surely as it shrinks apparent size, and a far butterfly crossing the box at
  // the near plane's speed is the single loudest way to break the illusion:
  // it stops being far away and becomes small and frantic.
  //
  // The wingbeat is the exception, and stays in Hz. A butterfly across the room
  // beats at the rate it beats at; only the *distance* its wing tip travels
  // falls off, and the projection already does that.
  const size = planeSize(f.depth);

  // --- the beat
  const hz = Math.max(0.05, B.hz * (1 + f.hzJitter * B.hzSpread));
  if (f.gliding) {
    if (f.state !== "landing" && t >= f.glideUntil) {
      f.gliding = false;
      f.glideAt = t + gap(f.rng(), FLIGHT.glide.rate);
    }
  } else {
    const prev = f.beatU;
    f.beatU = wrap01(f.beatU + hz * dt);
    if (!f.wantsGlide && t >= f.glideAt) f.wantsGlide = true;
    if (f.wantsGlide && crossed(prev, f.beatU, glideEntryU)) {
      f.wantsGlide = false;
      f.gliding = true;
      f.beatU = glideEntryU;
      f.glideUntil = t + lerp(FLIGHT.glide.minSec, FLIGHT.glide.maxSec, f.rng());
    }
  }
  if (f.state === "landing") {
    f.gliding = true;
    if (t >= f.landUntil) {
      f.state = "resting";
      f.gliding = false;
      f.speed = 0;
      f.bobAmp = 0;
      f.bob = 0;
      f.glideAt = t + gap(f.rng(), FLIGHT.glide.rate);
      return;
    }
  }

  // --- where it wants to go
  f.wanderT += D.scale * dt;
  let turn = (fbm(f.wanderT, f.wanderRow, f.noiseSeed, 2) - 0.5) * 2 * D.turn;

  if (t >= f.decideAt) {
    const dir = f.rng() < 0.5 ? -1 : 1;
    f.turnRate = (dir * rad(FLIGHT.decide.turnDeg)) / Math.max(0.05, FLIGHT.decide.sec);
    f.turnUntil = t + FLIGHT.decide.sec;
    f.decideAt = t + gap(f.rng(), FLIGHT.decide.rate);
  }
  if (t < f.turnUntil) turn += f.turnRate;

  // --- the edges of this plane's box
  const E = FLIGHT.edge;
  const margin = Math.max(1, E.margin * size);
  let ex = 0;
  let ey = 0;
  let urgency = 0;
  const push = (d: number, nx: number, ny: number) => {
    if (d >= margin) return;
    const k = 1 - Math.max(0, d) / margin;
    ex += nx * k * k;
    ey += ny * k * k;
    if (k > urgency) urgency = k;
  };
  push(f.x - bounds.x, 1, 0);
  push(bounds.x + bounds.w - f.x, -1, 0);
  push(f.y - bounds.y, 0, 1);
  push(bounds.y + bounds.h - f.y, 0, -1);

  let pushX = 0;
  let pushY = 0;
  if (urgency > 0) {
    const len = Math.hypot(ex, ey) || 1;
    turn += angleDelta(f.heading, Math.atan2(ey / len, ex / len)) * E.turn * urgency;
    pushX += (ex / len) * E.push * size * urgency;
    pushY += (ey / len) * E.push * size * urgency;
  }

  // --- the others. separation only, and only within a plane.
  //
  // Two butterflies at different depths are not near each other however close
  // their screen positions are — a far one passing behind a near one is the
  // picture working, not a collision to be resolved. Letting the planes shove
  // each other would couple them, and a box whose layers flinch at one another
  // stops being layers.
  //
  // A butterfly away at the cursor is nobody's neighbour either. It has come
  // forward out of the plane it is nominally still on, and the swarm flinching
  // away from where it used to be would be a hole in the picture with nothing
  // in it.
  const A = FLIGHT.avoid;
  const radius = Math.max(1, A.radius * size);
  let ax = 0;
  let ay = 0;
  let crowd = 0;
  for (const g of flyers) {
    if (g === f || g.lookPlane !== f.lookPlane || g.visit !== "none") continue;
    const dx = f.x - g.x;
    const dy = f.y - g.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= radius * radius || d2 === 0) continue;
    const d = Math.sqrt(d2);
    const k = 1 - d / radius;
    ax += (dx / d) * k;
    ay += (dy / d) * k;
    if (k > crowd) crowd = k;
  }
  if (crowd > 0) {
    const len = Math.hypot(ax, ay) || 1;
    turn += angleDelta(f.heading, Math.atan2(ay / len, ax / len)) * A.turn * crowd;
    pushX += (ax / len) * A.push * size * crowd;
    pushY += (ay / len) * A.push * size * crowd;
  }

  // --- move
  f.heading += turn * dt;
  const cruise = Math.max(0, D.speed * size * (1 + f.speedJitter * D.speedSpread));
  const want =
    f.state === "landing" ? 0 : f.gliding ? cruise * FLIGHT.glide.speed : cruise;
  f.speed += (want - f.speed) * Math.min(1, D.ease * dt);
  f.x = clamp(f.x + (Math.cos(f.heading) * f.speed + pushX) * dt, bounds.x, bounds.x + bounds.w);
  f.y = clamp(f.y + (Math.sin(f.heading) * f.speed + pushY) * dt, bounds.y, bounds.y + bounds.h);

  // --- the bob, riding the beat a little behind it
  const wantBob = f.gliding ? 0 : 1;
  f.bobAmp += (wantBob - f.bobAmp) * Math.min(1, FLIGHT.bob.ease * dt);
  f.bob = FLIGHT.bob.amp * size * f.bobAmp * Math.sin(TAU * (f.beatU + FLIGHT.bob.phase));
}

function takeOff(f: Flyer, t: number): void {
  f.state = "flying";
  f.gliding = false;
  f.wantsGlide = false;
  f.beatU = f.rng();
  f.heading = f.rng() * TAU;
  f.speed = 0;
  f.glideAt = t + gap(f.rng(), FLIGHT.glide.rate);
  f.decideAt = t + gap(f.rng(), FLIGHT.decide.rate);
}

// --- the bob, for one that is away visiting ---------------------------------
//
// A visiting butterfly is gliding in, and a glide has no bob in it — a wing
// pushes air before the body answers, and these wings are opening rather than
// beating. So the bob is eased out rather than dropped, which is the same
// treatment a glide gets and for the same reason: a bob frozen at an offset is
// a butterfly hanging a couple of pixels off where it belongs.
//
// It is here rather than in visit.ts because it is the body answering the
// wings, and the wings are this file's.
function calmBob(f: Flyer, dt: number): void {
  f.speed = 0;
  f.bobAmp += (0 - f.bobAmp) * Math.min(1, FLIGHT.bob.ease * dt);
  f.bob =
    FLIGHT.bob.amp *
    planeSize(f.depth) *
    f.bobAmp *
    Math.sin(TAU * (f.beatU + FLIGHT.bob.phase));
}

// --- drawing ---------------------------------------------------------------

export function drawFlight(ctx: CanvasRenderingContext2D, dpr: number): void {
  // Far to near, and within a plane by y — lower on the sheet is nearer the
  // viewer. Plane wins over y, and has to: a butterfly at the bottom of the back
  // plane's box is still behind one at the top of the front plane's, and the two
  // rects overlap, so sorting by y alone would let the back of the box paint
  // over the front of it.
  //
  // A butterfly on its way to the cursor is in front of all of it, whatever
  // plane its age says it belongs to, because it has left that plane and come
  // forward. It is the foreground and everything else is behind it.
  if (order.length !== flyers.length) order = flyers.slice();
  else for (let i = 0; i < flyers.length; i++) order[i] = flyers[i];
  order.sort(byDepthThenY);

  for (const f of order) {
    if (f.visit !== "none") {
      drawVisitor(ctx, f, dpr);
      continue;
    }
    const plane = planeAt(f.lookPlane);
    renderButterfly(
      ctx,
      f.spec,
      f.palette,
      f.x,
      f.y + f.bob,
      plane.scale,
      dpr,
      poseIndexOf(f, plane.phases),
      plane.look,
    );
  }
}

function byDepthThenY(a: Flyer, b: Flyer): number {
  const av = a.visit !== "none" ? 1 : 0;
  const bv = b.visit !== "none" ? 1 : 0;
  if (av !== bv) return av - bv;
  if (a.lookPlane !== b.lookPlane) return b.lookPlane - a.lookPlane;
  return a.y - b.y;
}

/**
 * Which tile of the sprite sheet to blit, given how many of them this plane is
 * allowed to use.
 *
 * A far plane does not get its own pose table — it *samples* the near one. The
 * beat is quantised to `phases` steps in time and each step takes the nearest
 * pose the full table has, so a plane using six of twelve walks 0, 2, 4, 6, 8,
 * 10 and touches six tiles rather than twelve. The timing stays even, because
 * `phases` divides the cycle rather than the table.
 *
 * Doing it this way is what makes level of detail free. Separate tables per
 * plane would need separate rest and glide poses, a rebuild path each, and a
 * bug the first time one of them went stale; this needs one table and an index.
 */
function poseIndexOf(f: Flyer, phases: number): number {
  if (f.state === "resting") return POSE_REST;
  if (f.gliding) return POSE_GLIDE;
  const n = phaseCount;
  const m = Math.max(1, Math.min(n, Math.round(phases)));
  const k = Math.floor(wrap01(f.beatU) * m) % m;
  return POSE_BEAT + ((Math.round((k * n) / m) % n) + n) % n;
}

// --- population ------------------------------------------------------------

// Match the flyers to the roster, keeping whatever is already in the air.
// Position, heading, beat phase and sleep all survive a recolour; only a kigo
// that has actually left the store loses its place in the box.
function reconcile(bounds: Rect): void {
  if (!rosterChanged) return;
  rosterChanged = false;

  const airborne = new Map(flyers.map((f) => [f.id, f]));
  const next: Flyer[] = [];
  for (const member of roster) {
    const already = airborne.get(member.id);
    if (already) {
      already.palette = member.palette;
      // Its age moved because the clock moved, not because the kigo did. The
      // eased `depth` is deliberately left alone: this is the value the new
      // target is eased *from*, and it is the whole of the recession animation.
      already.bucketsAgo = member.bucketsAgo;
      // A touch rewrites this file, and a landed butterfly is very often the
      // one it rewrote. Its visit survives untouched — the whole point of a
      // touch is that it happens while you are holding the thing.
      already.text = member.text;
      airborne.delete(member.id);
      next.push(already);
    } else {
      next.push(makeFlyer(member, bounds));
    }
  }
  flyers.length = 0;
  flyers.push(...next);
  // Whoever was at the cursor may have just left the store, in which case the
  // visit has nobody in it.
  dropVisitorUnless(flyers);
}

/**
 * What it means for the swarm to give one of its own to the cursor.
 *
 * visit.ts decides *who* and *when*; this is the part that is flight's — waking
 * it if it was asleep, and putting it into a glide, because this is a landing
 * approach and the opening ramp starts at exactly the glide pose so stepping
 * onto it is not a step at all.
 */
function callOut(f: Flyer, t: number): void {
  if (f.state !== "flying") takeOff(f, t);
  f.gliding = true;
  f.wantsGlide = false;
}

function makeFlyer(member: Member, bounds: Rect): Flyer {
  const id = member.id;
  // Seeded off the id alone. Ids are unique now that the swarm comes from the
  // store — the copy index this used to mix in was there because the dev list
  // was cycled twice to reach forty, and two butterflies from one id shared a
  // wingbeat frequency, which the eye finds immediately.
  const rng = mulberry32((hashString(id) ^ 0x9e3779b1) >>> 0);
  // Born already at its own depth rather than easing in from the glass. A
  // butterfly that has been in the box for two years did not arrive this
  // second, and the alternative — a hundred and fifty of them swimming
  // backwards out of the front of the box on startup — announces the machinery
  // rather than the picture.
  const depth = clamp(planeOf(member.bucketsAgo), 0, planeCount() - 1);
  const rect = boundsAt({ x: 0, y: 0, w: 0, h: 0, r: 0 }, bounds, depth);
  return {
    id,
    spec: specFor(id),
    palette: member.palette,
    rng,
    bucketsAgo: member.bucketsAgo,
    depth,
    lookPlane: depth,
    rect,
    x: rect.x + rng() * rect.w,
    y: rect.y + rng() * rect.h,
    heading: rng() * TAU,
    speed: 0,
    hzJitter: rng() * 2 - 1,
    speedJitter: rng() * 2 - 1,
    beatU: rng(),
    wanderT: rng() * 100,
    wanderRow: rng() * 64,
    noiseSeed: (hashString(id) ^ 0x85ebca6b) >>> 0,
    decideAt: rng() * 4,
    turnRate: 0,
    turnUntil: 0,
    gliding: false,
    wantsGlide: false,
    glideUntil: 0,
    glideAt: rng() * 8,
    state: "flying",
    landUntil: 0,
    bobAmp: 1,
    bob: 0,
    visit: "none",
    visitU: 0,
    text: member.text,
  };
}

// --- the panel's view of all this ------------------------------------------

type NumberBag = Record<string, number>;

function knob(
  group: string,
  bag: NumberBag,
  key: string,
  min: number,
  max: number,
  step: number,
  rebuild = false,
): Knob {
  return {
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
  };
}

/**
 * Every motion constant, as a slider.
 *
 * `rebuild` marks the ones that change what is drawn rather than how it moves:
 * those throw away the sprite sheet, which the next frame rebuilds lazily —
 * about forty tiles, not the whole cache, because only the phases actually on
 * screen get asked for.
 *
 * The depth constants have their own home in planes.ts and their own knobs
 * there; they are spliced in below so the panel is still one panel.
 */
export function flightKnobs(): Knob[] {
  const F = FLIGHT as unknown as NumberBag;
  const B = FLIGHT.beat as NumberBag;
  const D = FLIGHT.drift as NumberBag;
  const C = FLIGHT.decide as NumberBag;
  const G = FLIGHT.glide as NumberBag;
  const O = FLIGHT.bob as NumberBag;
  const E = FLIGHT.edge as NumberBag;
  const A = FLIGHT.avoid as NumberBag;
  const R = FLIGHT.rest as NumberBag;

  return [
    // The one that sizes the whole thing, and it rebuilds: the wingspan is part
    // of the tile cache key, so dragging it throws the sprite sheet away. How
    // many butterflies there are is not a knob — it is how many kigo there are.
    knob("swarm", F, "wingspan", 10, 64, 1, true),

    ...planeKnobs(),

    knob("beat", B, "phases", 4, 24, 1, true),
    knob("beat", B, "hz", 0.4, 6, 0.05),
    knob("beat", B, "hzSpread", 0, 1, 0.01),
    knob("beat", B, "upDeg", 0, 85, 1, true),
    knob("beat", B, "downDeg", -85, 20, 1, true),
    knob("beat", B, "glideDeg", -40, 60, 1, true),
    knob("beat", B, "restDeg", -60, 40, 1, true),
    knob("beat", B, "hindAmp", 0, 1.2, 0.01, true),
    knob("beat", B, "hindLag", -0.4, 0.4, 0.01, true),
    knob("beat", B, "skew", -0.9, 0.9, 0.01, true),
    knob("beat", B, "camera", 1.4, 12, 0.1, true),

    knob("drift", D, "speed", 0, 60, 0.5),
    knob("drift", D, "speedSpread", 0, 1, 0.01),
    knob("drift", D, "scale", 0.05, 3, 0.01),
    knob("drift", D, "turn", 0, 8, 0.05),
    knob("drift", D, "ease", 0.2, 8, 0.05),

    knob("decide", C, "rate", 0, 2, 0.01),
    knob("decide", C, "turnDeg", 0, 180, 1),
    knob("decide", C, "sec", 0.1, 3, 0.05),

    knob("glide", G, "rate", 0, 2, 0.01),
    knob("glide", G, "minSec", 0.1, 4, 0.05),
    knob("glide", G, "maxSec", 0.2, 8, 0.05),
    knob("glide", G, "speed", 0, 1.5, 0.01),

    knob("bob", O, "amp", 0, 12, 0.1),
    knob("bob", O, "phase", 0, 1, 0.01),
    knob("bob", O, "ease", 0.5, 10, 0.1),

    knob("edge", E, "margin", 4, 120, 1),
    knob("edge", E, "turn", 0, 10, 0.1),
    knob("edge", E, "push", 0, 150, 1),

    knob("avoid", A, "radius", 4, 120, 1),
    knob("avoid", A, "turn", 0, 10, 0.1),
    knob("avoid", A, "push", 0, 80, 1),

    knob("rest", R, "fraction", 0, 1, 0.01),
    knob("rest", R, "wakeRate", 0, 0.5, 0.005),
    knob("rest", R, "landRate", 0, 1, 0.005),
    knob("rest", R, "settleSec", 0.1, 5, 0.05),

    // The visit and the words on the opened wings. Both live in visit.ts now
    // and bring their own knobs, for the same reason planes.ts does.
    ...visitKnobs(),

    // Not motion, but tuned against motion. How hard a panel's angle reads is
    // only judgeable while the angle is changing, so these belong next to the
    // beat rather than in a separate session with a static butterfly.
    knob("shading", SHADE, "foldContrast", 0, 2, 0.01, true),
    knob("shading", SHADE, "foldGamma", 0.2, 1.5, 0.01, true),
    knob("shading", SHADE, "foldMaxAlpha", 0, 1, 0.01, true),
    knob("shading", SHADE, "panelSplit", 0, 0.3, 0.005, true),
  ];
}

// The shading knobs front BUTTERFLY.render, which is art rather than animation
// and lives with the rest of the art. Two homes, one panel.
const SHADE = BUTTERFLY.render as unknown as NumberBag;

const SHADE_KEYS = ["foldContrast", "foldGamma", "foldMaxAlpha", "panelSplit"] as const;

/**
 * The current values, in blocks that paste straight back over the objects they
 * came from. A block per object rather than one big one, because several
 * objects in several files are being tuned — pretending otherwise would produce
 * a dump that looks pasteable and isn't.
 */
export function flightConfigJson(): string {
  const shade: Record<string, number> = {};
  for (const k of SHADE_KEYS) shade[k] = SHADE[k];
  return (
    `// src/flight.ts — replaces FLIGHT\n${JSON.stringify(FLIGHT, null, 2)}\n\n` +
    `// src/planes.ts — replaces PLANES\n${JSON.stringify(PLANES, null, 2)}\n\n` +
    `// src/visit.ts — replaces VISIT\n${JSON.stringify(VISIT, null, 2)}\n\n` +
    `// src/wing-text.ts — replaces WING_TEXT\n${JSON.stringify(WING_TEXT, null, 2)}\n\n` +
    `// src/butterfly.ts — merge into BUTTERFLY.render\n${JSON.stringify(shade, null, 2)}\n`
  );
}

// --- small maths -----------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function wrap01(u: number): number {
  return u - Math.floor(u);
}

// Exponentially spaced waits. A fixed interval reads as a schedule; this reads
// as "every so often", which is the difference between a decision and a tick.
function gap(r: number, rate: number): number {
  if (rate <= 0) return Infinity;
  return Math.min(30, -Math.log(1 - Math.min(r, 0.999999)) / rate);
}

/**
 * Did the beat pass `target` between these two positions in the cycle?
 *
 * Exported because the wrapped case is where this quietly breaks: at 10fps a
 * beat can advance most of a cycle in one frame, and a version of this that
 * only handled prev < next would drop the crossing whenever it straddled the
 * wrap — glides would then stop happening at exactly the cadence the widget
 * spends most of its life in.
 */
export function crossed(prev: number, next: number, target: number): boolean {
  if (next >= prev) return target > prev && target <= next;
  return target > prev || target <= next; // wrapped past 1
}

function angleDelta(from: number, to: number): number {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
