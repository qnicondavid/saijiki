// The depth of the box: which plane a kigo sits on, what that plane looks like,
// and how a butterfly travels between them.
//
// Depth encodes *age* — how long ago a kigo was recorded. Fading encodes
// *aliveness* — how long since it was touched. Two channels, and the whole
// reason the treatment here is as careful as it is: the mixed cases have to stay
// readable. Something begun two years ago but touched last week is far and
// vivid; something begun last spring and left alone is nearer and pale.
//
// This module knows nothing about butterflies, motion, or the swarm. It is a
// table of planes and the arithmetic that puts a date on one of them, which is
// why it can be read — and tested — without a canvas or a frame.
//
// The table is derived once and held, rather than recomputed per butterfly per
// frame. That is not only for speed: a plane's `look.key` is the tile cache key,
// and it says only which plane it is. Every constant that changes what a plane
// *looks* like is therefore a `rebuild` knob — dragging one throws the whole
// tile cache away through setWingPoses and this table is rebuilt with it. A
// depth constant that was not a rebuild knob would leave stale art behind under
// a live key, which is the one way this cache can lie.

import { NEAR, type DepthLook } from "./butterfly-render";
import type { Rect } from "./paper";
import type { Knob } from "./tuning-panel";

// --- the config ------------------------------------------------------------
//
//   `edges`  the age, in buckets, at which a kigo drops to the next plane
//            back. Length + 1 is the plane count, which is five: enough for a
//            recession to read in a 420x300 box and few enough that the tile
//            cache holds every plane at once.
//
//            One season, then doubling — 3, 6, 12, 24 buckets, which is one
//            season, two, four, eight. Near planes are thin in time and far
//            ones thick, which is what perspective does to depth, and it means
//            `}` (a season) steps the front of the swarm back exactly one
//            plane while the back of it barely stirs.
//
//            CLAUDE.md's model — one bucket per plane, [1, 2, 3, 4] — is a
//            legal setting and reachable from the sliders. It is not the
//            default because against a three-year store it measures at
//            7 · 5 · 0 · 0 · 138: two empty planes and everything on the back
//            wall, which is a front and a back rather than a box. See the note
//            on `depthPlan` in flight.test.ts, which pins the distribution.
//
//   `far*`   what the last plane looks like. Every plane in between is
//            interpolated on p / (planes - 1) — geometrically for scale and
//            phases, so the two stay in step (see `planePhases`), linearly for
//            the rest.

export const PLANES = {
  edges: [3, 6, 12, 24],
  farScale: 0.5, // wingspan at the back, as a fraction of the glass
  farShrink: 0.34, // how far the box narrows: the back plane's bounds are 66%
  farRest: 0.82, // older memories are calmer. the near plane is where movement is
  farPhases: 6, // wingbeat tiles at the back. see planePhases for why six
  farHaze: 0.34, // aerial perspective: mix toward PAPER.aerial. never blur
  farShadowScale: 1.9, // longer and wider with distance
  farShadowAlpha: 0.5, // and fainter
  easeSec: 0.75, // how long a plane change takes to travel. a scrub, mostly
};

/**
 * The plane at the glass, which is the one everything else is measured back
 * from. These three numbers live in FLIGHT — they are the wingspan, the full
 * wingbeat tile count and the resting fraction — and flight.ts hands them over
 * at load and again on every rebuild.
 *
 * The copy below is only so that importing this module on its own still yields
 * a table. planes.test.ts pins the two against each other, so they cannot drift
 * apart in silence.
 */
export interface NearPlane {
  /** css px per wingspan at the glass. */
  scale: number;
  /** how many wingbeat tiles the full pose table holds. */
  phases: number;
  /** fraction of the glass plane's flyers that should be settled. */
  rest: number;
}

let near: NearPlane = { scale: 26, phases: 12, rest: 0.35 };

export function setNearPlane(next: NearPlane): void {
  near = { ...next };
  rebuildPlanes();
}

// --- the table -------------------------------------------------------------

export interface Plane {
  /** 0 is at the glass. */
  index: number;
  /** css px per wingspan, rounded — this is part of the tile cache key. */
  scale: number;
  /** how many of the full table's wingbeat tiles this plane samples. */
  phases: number;
  /** fraction of this plane's flyers that should be settled. */
  rest: number;
  look: DepthLook;
}

let planes: Plane[] = [];

export function planeCount(): number {
  return PLANES.edges.length + 1;
}

/** How far back a plane sits, as 0 at the glass and 1 at the back wall. */
export function depthU(depth: number): number {
  const n = planeCount();
  return n <= 1 ? 0 : clamp(depth, 0, n - 1) / (n - 1);
}

/**
 * How big a butterfly at this depth is on screen, as a fraction of one at the
 * glass. Continuous rather than the drawn plane's scale, so nothing about the
 * motion steps at the same instant the art does.
 */
export function planeSize(depth: number): number {
  return Math.pow(PLANES.farScale, depthU(depth));
}

/**
 * Which plane a kigo recorded `bucketsAgo` buckets ago belongs to.
 *
 * Everything older than the last edge accumulates on the back plane, which is
 * by design: the back of the box is the past, and it is also — because the far
 * plane is the smallest and has the fewest wingbeat tiles — the cheapest place
 * for a crowd to be. The plane that grows without bound is the one that costs
 * least per creature.
 */
export function planeOf(bucketsAgo: number): number {
  const edges = PLANES.edges;
  for (let i = 0; i < edges.length; i++) if (bucketsAgo < edges[i]) return i;
  return edges.length;
}

/**
 * Wingbeat tiles for a plane, geometric on the same curve as the scale.
 *
 * Six at the back is not a guess. What a wingbeat costs the eye is how far the
 * silhouette jumps between one tile and the next, and the silhouette's half
 * width is (wingspan / 2)·cos(theta): at the glass, twelve phases move the wing
 * tip about one css px per tile. Halving the wingspan halves that, so halving
 * the phase count with it lands on the same one px per tile — the far plane is
 * quantised exactly as finely as the near one *in pixels*, which is the only
 * unit the eye is working in. Fewer than six is visibly steppier than the front
 * of the box; more than six is tiles nobody can see.
 */
export function planePhases(plane: number): number {
  const full = Math.max(2, Math.round(near.phases));
  const far = Math.max(2, Math.min(full, Math.round(PLANES.farPhases)));
  const n = Math.round(full * Math.pow(far / full, depthU(plane)));
  return Math.min(full, Math.max(2, n));
}

export function rebuildPlanes(): void {
  const D = PLANES;
  const n = planeCount();
  planes = [];
  for (let p = 0; p < n; p++) {
    const u = depthU(p);
    planes.push({
      index: p,
      // Two decimals because renderButterfly keys on scale.toFixed(2). Rounding
      // it here rather than leaving it to the key means the value in the tile
      // and the value in the key are the same number, and there are exactly
      // `n` of them however the wingspan slider is dragged.
      scale: round2(near.scale * Math.pow(D.farScale, u)),
      phases: planePhases(p),
      rest: clamp(lerp(near.rest, D.farRest, u), 0, 1),
      look:
        p === 0
          ? NEAR
          : {
              key: `d${p}`,
              haze: D.farHaze * u,
              shadowScale: lerp(1, D.farShadowScale, u),
              shadowAlpha: lerp(1, D.farShadowAlpha, u),
            },
    });
  }
}

/** The plane table, for the overlay and for tests. Rebuilt with the poses. */
export function planeTable(): readonly Plane[] {
  if (planes.length !== planeCount()) rebuildPlanes();
  return planes;
}

export function planeAt(index: number): Plane {
  const table = planeTable();
  return table[clamp(Math.round(index), 0, table.length - 1)];
}

/**
 * A plane's look, brought `u` of the way to the glass.
 *
 * For a butterfly that has come forward out of its plane. Distance is the only
 * thing being undone here — the haze thins, the shadow tightens and darkens —
 * and `u` arrives already quantised, so this mints a handful of cache keys
 * rather than one per frame. At u = 0 it is the plane's own look, key and all,
 * so coming forward starts from exactly the tile that was already on screen.
 */
export function planeLookAt(index: number, u: number): DepthLook {
  const look = planeAt(index).look;
  if (u <= 0 || look.haze === 0) return look;
  if (u >= 1) return NEAR;
  return {
    key: `${look.key}+${Math.round(u * 100)}`,
    haze: look.haze * (1 - u),
    shadowScale: lerp(look.shadowScale, 1, u),
    shadowAlpha: lerp(look.shadowAlpha, 1, u),
  };
}

// --- the box ---------------------------------------------------------------

/**
 * A plane's rect: the mouth of the box, shrunk toward its own centre.
 *
 * The inset is what makes five planes read as a box rather than as five sheets
 * stacked on a desk. Scale alone would not do it — a small butterfly wandering
 * into the corner of the full sheet reads as a small butterfly, not a distant
 * one, because nothing in the picture says the far wall is smaller than the
 * near one. Keeping it off the corners is the wall.
 *
 * `depth` is the eased, continuous value, so a butterfly changing planes
 * travels between the two rects instead of appearing in the new one.
 */
export function boundsAt(out: Rect, base: Rect, depth: number): Rect {
  const k = 1 - PLANES.farShrink * depthU(depth);
  out.w = base.w * k;
  out.h = base.h * k;
  out.x = base.x + (base.w - out.w) / 2;
  out.y = base.y + (base.h - out.h) / 2;
  out.r = 0;
  return out;
}

/** The same thing, allocating. For tests and for anything drawing the box. */
export function planeBounds(base: Rect, depth: number): Rect {
  return boundsAt({ x: 0, y: 0, w: 0, h: 0, r: 0 }, base, depth);
}

// --- the transition --------------------------------------------------------

/**
 * One frame of the journey between planes.
 *
 * Exponential, so it is frame-rate independent and arrives without a stop, and
 * snapped at the end so a butterfly that has arrived is exactly on its plane
 * rather than asymptotically near it — the drawn plane is `Math.round(depth)`
 * and a value hovering at 2.4999 would flip planes on a rounding wobble.
 */
export function easeDepth(depth: number, target: number, dt: number): number {
  if (dt <= 0) return depth;
  const next = depth + (target - depth) * (1 - Math.exp(-dt / Math.max(0.01, PLANES.easeSec)));
  return Math.abs(target - next) < 0.002 ? target : next;
}

// --- the panel's view of all this ------------------------------------------

// The plane edges are an array rather than a bag, so they need their own knob.
// The label says what the number means — the age at which a kigo falls behind
// this plane — because "edges[2]" on a slider means nothing at all.
function edgeKnob(i: number, min: number, max: number): Knob {
  return {
    group: "depth",
    label: `plane ${i} ends`,
    hint: "age in buckets at which a kigo drops to the next plane back",
    min,
    max,
    step: 1,
    rebuild: true,
    get: () => PLANES.edges[i],
    set: (v) => {
      PLANES.edges[i] = Math.round(v);
    },
  };
}

/**
 * Every depth constant, as a slider.
 *
 * All but one of these rebuilds, including the ones that only look like
 * simulation: a plane's tile cache key says nothing but which plane it is, so
 * the art behind that key has to be thrown away whenever any of them moves.
 * `easeSec` is the exception and the only one here that is purely motion.
 *
 * The edges are ages in buckets and must stay in order — an edge dragged past
 * its neighbour empties the plane between them, which the F9 overlay's `depth:`
 * line shows as a zero. Setting them to 1, 2, 3, 4 gives CLAUDE.md's
 * one-bucket-per-plane model exactly.
 */
export function planeKnobs(): Knob[] {
  const D = PLANES as unknown as Record<string, number>;
  const knob = (key: string, min: number, max: number, step: number, rebuild = false): Knob => ({
    group: "depth",
    label: key,
    min,
    max,
    step,
    rebuild,
    get: () => D[key],
    set: (v) => {
      D[key] = v;
    },
  });

  return [
    ...PLANES.edges.map((_, i) =>
      edgeKnob(i, i === 0 ? 1 : 2, i === PLANES.edges.length - 1 ? 60 : 40),
    ),
    knob("farScale", 0.2, 1, 0.01, true),
    knob("farShrink", 0, 0.7, 0.01, true),
    knob("farRest", 0, 1, 0.01, true),
    knob("farPhases", 2, 24, 1, true),
    knob("farHaze", 0, 0.8, 0.01, true),
    knob("farShadowScale", 0.5, 4, 0.05, true),
    knob("farShadowAlpha", 0, 2, 0.01, true),
    knob("easeSec", 0.05, 4, 0.05),
  ];
}

// --- small maths -----------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** To the two decimals the tile cache key reads, so the two are one number. */
export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
