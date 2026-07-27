// The butterfly's phenotype: draw a spec, held in a given wing pose. This
// module knows nothing about ids, and nothing about flight.
//
// --- why this is a sprite sheet -------------------------------------------
//
// The wings genuinely rotate about the fold. That is not decoration: a wing
// held at 60° really is 34% as wide on screen as one lying flat, and the cuts
// punched through it narrow with it, and the bevel down each cut wall changes
// which side of itself catches the light. None of that survives squashing a
// finished picture — an x-scale is the one thing a rigid rotation about a
// vertical axis looks exactly like, right up until you add perspective,
// per-panel angles, and shading, at which point it stops looking like anything
// else at all.
//
// So a butterfly is not one tile. The wingbeat is quantised into a fixed number
// of phases and every phase is pre-rendered: texture, bevel, cut edges, cast
// shadow, the lot. Forty butterflies each cycle their whole phase set inside one
// wingbeat, so within a second of starting, every tile that will ever be needed
// exists and each frame is forty blits. Drawing this live forty times a frame
// does not hold 60fps, and there is no version of finding that out later that is
// cheap.
//
// The cache key is spec + palette + scale + dpr + phase + depth look — the
// complete set of inputs. If anything else could change the picture, this cache
// would be a bug; the wing pose table is therefore not a key but a global, and
// replacing it clears the cache. Depth planes are what make `scale` safe to key
// on: it takes one of five values rather than a continuum, so a swarm receding
// across the box steps between five sprite sheets instead of minting one per
// butterfly per frame.
//
// --- why the boundaries look like that ------------------------------------
//
// Every boundary in here is a *cut*, and cut paper has thickness. That is what
// the two offset strokes do: a pale rim where the cut wall turns toward the key
// light, a dark one where it turns away. Offsetting the whole even-odd path and
// keeping only what lands on paper gets both the outer silhouette and the
// punched holes right in a single pass, with opposite sense, for free.

import { BUTTERFLY, type ButterflySpec, type Pt, type WingPanel } from "./butterfly";
import { fbm, hashString } from "./noise";
import { PAPER } from "./paper";
import type { Palette } from "./papers";

type RGB = [number, number, number];

const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// --- the pose --------------------------------------------------------------

/**
 * How far each pair of panels is held off the picture plane, in radians.
 * Positive lifts the wing toward the viewer, negative presses it back toward
 * the sheet. Fore and hind are separate because they are separate pieces of
 * paper: the hindwing beats shallower and trails the forewing, and the two
 * never lying in the same plane is a large part of why a beat reads as a
 * creature rather than as a shutter.
 */
export interface WingPose {
  fore: number;
  hind: number;
}

// Fixed slots at the head of the pose table, so a caller that only wants a
// still butterfly never has to know how the beat is quantised.
export const POSE_REST = 0;
export const POSE_GLIDE = 1;
export const POSE_BEAT = 2; // beat phases run POSE_BEAT .. POSE_BEAT + n - 1

// --- distance --------------------------------------------------------------

/**
 * How far away a butterfly is, expressed as everything the *tile* has to do
 * differently about it. This module knows nothing about depth planes — only
 * that a creature can be near or far, and what that costs it.
 *
 * Recession here is **aerial perspective**, never blur. CLAUDE.md forbids
 * gaussian depth outright, and it is right to: blurred paper is a photograph of
 * a diorama rather than a diorama, and the whole voice is handmade. So distance
 * is a wash of the sheet's own colour laid over the finished creature, which is
 * what air actually does to things across a room.
 *
 * That wash is also what keeps depth and fading legible as two channels rather
 * than one, which is the claim the depth step rests on:
 *
 *   · Fading drains chroma at *constant lightness* — `drain` in papers.ts pulls
 *     a colour toward its own luminance grey. A bleached butterfly is exactly
 *     as dark as it ever was.
 *   · Haze moves the whole colour toward cream, so it *lightens* as it
 *     desaturates and it compresses contrast against the sheet.
 *
 * Same nominal direction, different curve — and depth also carries size and
 * shadow, which fading never touches. A far vivid butterfly (recorded two years
 * ago, touched last week) is small, pale-and-light, with a long soft shadow. A
 * near faded one is big, grey-but-dark, with a tight black one. They do not
 * collide.
 */
export interface DepthLook {
  /** Cache key fragment. Distinct per plane; empty for the near/default look. */
  key: string;
  /** 0..1, mixed toward PAPER.aerial over the finished tile. */
  haze: number;
  /** Multiplies the cast shadow's blur and its offset. Longer and wider, far. */
  shadowScale: number;
  /** Multiplies the cast shadow's darkness. Fainter, far. */
  shadowAlpha: number;
}

/** At the glass: full contrast, tight shadow, no air in the way. */
export const NEAR: DepthLook = Object.freeze({
  key: "",
  haze: 0,
  shadowScale: 1,
  shadowAlpha: 1,
});

// Wings a touch back from the picture plane: the shallow mountain fold of a
// mounted specimen. What the gallery draws, and what everything draws before
// flight has had a chance to install a real table.
const DEFAULT_REST: WingPose = { fore: -0.2, hind: -0.13 };

let poses: WingPose[] = [DEFAULT_REST, DEFAULT_REST];
let camera = 3.4;

/**
 * Install the pose table. `beat` is the quantised wingbeat, in order; `rest` and
 * `glide` take the two fixed slots ahead of it. `cameraDist` is the viewer's
 * distance in wingspans — it controls how much a lifted wing splays as it comes
 * toward you, and at infinity the whole projection degenerates into the x-scale
 * this is at pains not to be.
 *
 * Every tile in the cache was rendered against the old table, so this throws
 * them all away. The dyed paper survives: it does not depend on the pose, and
 * regenerating it is most of the cost of a rebuild.
 */
export function setWingPoses(
  rest: WingPose,
  glide: WingPose,
  beat: WingPose[],
  cameraDist: number,
): void {
  poses = [rest, glide, ...beat];
  camera = Math.max(1.2, cameraDist);
  tiles.forEach((t) => (bytes -= t.bytes));
  tiles.clear();
  boxes.clear();
}

/**
 * Draw `spec` centred on its unit origin at (x, y), `scale` css px per unit —
 * which, since the wingspan is one unit, is the wingspan in css px.
 *
 * `dpr` is passed rather than read off the context's transform, because motion
 * puts transforms on that context and the transform's scale stops being the
 * device pixel ratio the moment anything else touches it.
 */
export function renderButterfly(
  ctx: CanvasRenderingContext2D,
  spec: ButterflySpec,
  palette: Palette,
  x: number,
  y: number,
  scale: number,
  dpr: number,
  phase: number = POSE_REST,
  look: DepthLook = NEAR,
): void {
  const i = phase >= 0 && phase < poses.length ? phase : POSE_REST;
  const key = `${spec.id}|${spec.version}|${palette.key}|${scale.toFixed(2)}|${dpr.toFixed(2)}|${i}|${look.key}`;
  let tile = tiles.get(key);
  if (tile) {
    // Touch it. A Map iterates in insertion order, so deleting and re-setting
    // moves this tile to the back of the queue and turns the eviction below
    // from oldest-first into least-recently-used.
    //
    // That distinction only matters when the cache overflows, and it decides
    // what kind of overflow it is. Depth planes give the cache a way to fill up
    // with tiles nobody wants any more: scrub several seasons forward and every
    // butterfly leaves a whole plane's sprite sheet behind it, four of which
    // will overrun the capacity even though the working set is two thirds of
    // it. Oldest-first would evict a mixture — including tiles being blitted
    // this frame, which are then rebuilt, which evicts more — and the burst
    // would take a while to drain. Least-recently-used evicts exactly the
    // abandoned planes, in the order they were abandoned, and rebuilds nothing.
    tiles.delete(key);
    tiles.set(key, tile);
  } else {
    tile = buildTile(spec, palette, scale, dpr, poses[i], look);
    builds++;
    bytes += tile.bytes;
    while (tiles.size >= BUTTERFLY.cacheSize) {
      const stalest = tiles.keys().next().value;
      if (stalest === undefined) break;
      const dead = tiles.get(stalest);
      if (dead) bytes -= dead.bytes;
      tiles.delete(stalest);
      evictions++;
    }
    tiles.set(key, tile);
  }
  ctx.drawImage(tile.canvas, x + tile.ox, y + tile.oy, tile.cssW, tile.cssH);
}

export function clearButterflyCache(): void {
  tiles.clear();
  boxes.clear();
  dyes.clear();
  bytes = 0;
  dyeBytes = 0;
}

export interface ButterflyCacheStats {
  tiles: number;
  capacity: number;
  megabytes: number;
  /** Tiles rendered since the process started. Cumulative. */
  builds: number;
  /** Tiles thrown away to make room. Cumulative — see the note below. */
  evictions: number;
  /** Dyed-paper swatches, one per (palette, dpr). */
  dyes: number;
  dyeMegabytes: number;
}

/**
 * What the cache is costing.
 *
 * All of this is on the F9 overlay, because the ways it goes wrong are
 * invisible from the outside and all three look like "the motion is janky":
 *
 *   · Bloat. MB climbing with the wingspan slider.
 *   · Churn. Builds never settling to zero.
 *   · Thrash. `evictions` climbing steadily while `tiles` sits pinned at
 *     `capacity`. That is the fatal one: every butterfly cycles its whole phase
 *     set inside one wingbeat, so a working set one tile larger than the cache
 *     evicts the tile it is about to need, every frame, forever.
 *
 * The app was close to that until depth planes, and depth planes are what fixed
 * it — not by shrinking tiles but by moving the crowd. A hundred and fifty kigo
 * all at the near plane's fourteen poses is about twenty-one hundred tiles
 * against a cache of two thousand and forty-eight; spread across five planes,
 * with the far ones down to eight poses and the seeded store's ages putting most
 * of the swarm on them, it measures at about fourteen hundred. `swarmWorkingSet`
 * in flight.ts computes that live, and the F9 overlay prints it beside these —
 * which is the number to watch, because it says the cache is about to overflow
 * a frame before it does rather than a second after.
 *
 * A burst of evictions after several season scrubs in a row is expected and
 * harmless: those are abandoned depth planes draining out, the eviction order
 * takes them first, and it settles back to zero. Evictions that keep climbing
 * while nothing is being scrubbed are the real thing.
 */
export function butterflyCacheStats(): ButterflyCacheStats {
  return {
    tiles: tiles.size,
    capacity: BUTTERFLY.cacheSize,
    megabytes: bytes / (1024 * 1024),
    builds,
    evictions,
    dyes: dyes.size,
    dyeMegabytes: dyeBytes / (1024 * 1024),
  };
}

// --- caches ----------------------------------------------------------------

interface Tile {
  canvas: HTMLCanvasElement;
  cssW: number;
  cssH: number;
  ox: number; // blit offset from the butterfly's unit origin
  oy: number;
  bytes: number;
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const tiles = new Map<string, Tile>();
const boxes = new Map<string, Box>();
const dyes = new Map<string, HTMLCanvasElement>();
let bytes = 0;
let builds = 0;
let evictions = 0;
// The dye swatches are not in the tile budget and are not evicted, but they are
// keyed on the palette — and fading multiplied the palettes by five. Eight
// papers at five levels is forty swatches, which is worth being able to see.
let dyeBytes = 0;

// --- projection ------------------------------------------------------------

/**
 * A point on a panel hinged on the fold, held at `theta`, seen from
 * `cameraDist` wingspans away. The fold runs down x = 0 and does not move;
 * everything else swings about it.
 *
 * Orthographically this would collapse to x·cos(theta) — the x-scale the whole
 * module is at pains not to be. The perspective divide is what stops it: a
 * lifted wing tip is nearer the eye than the fold is, so it magnifies, and it
 * magnifies in *y* as well as x. The wing therefore splays vertically as it
 * narrows horizontally, which is exactly the shape a wing coming toward you
 * makes and exactly the shape no scale can make.
 *
 * Exported because it is the claim this whole step rests on, and because the
 * fold diagram (step 16) needs the same maths to draw a half-folded panel.
 */
export function projectOnFold(p: Pt, theta: number, cameraDist: number): Pt {
  if (theta === 0) return p;
  const z = Math.abs(p.x) * Math.sin(theta); // toward the viewer
  const m = cameraDist / (cameraDist - z);
  return { x: p.x * Math.cos(theta) * m, y: p.y * m };
}

function project(p: Pt, theta: number): Pt {
  return projectOnFold(p, theta, camera);
}

// PAPER.light.angleDeg points *toward* the source, so this vector points at the
// light and its negation is the direction shadows fall. The butterfly borrows
// the diorama's lighting rather than inventing its own — nothing sells layered
// paper faster than two objects disagreeing about where the sun is.
function lightDir(): { x: number; y: number } {
  const rad = (PAPER.light.angleDeg * Math.PI) / 180;
  return { x: Math.cos(rad), y: Math.sin(rad) };
}

// The same key light, as a unit vector in three dimensions: from the upper
// left, but mostly frontal. Needed because a panel's normal now has a z.
function light3(): { x: number; y: number; z: number } {
  const d = lightDir();
  const z = BUTTERFLY.render.lightZ;
  const n = Math.hypot(d.x, d.y, z) || 1;
  return { x: d.x / n, y: d.y / n, z: z / n };
}

// How much brighter or darker a panel is than the same panel lying flat.
//
// Hinging the panel on the fold swings its normal through x: lift the right
// wing and its face turns left, into a light that comes from the left. Lift the
// left wing and its face turns away from that same light. Which is why a
// butterfly at the top of its stroke is bright on one side and dark on the
// other, and why the pair of them read as one folded sheet rather than as two
// cutouts side by side.
//
// Half-lambert rather than lambert: paper in a lit room does not go black when
// it turns away from the key, and the clamped, gamma'd alpha downstream keeps
// the top of the stroke from looking scorched.
function panelShade(side: -1 | 1, theta: number, L: { x: number; z: number }, flat: number): number {
  const nx = -side * Math.sin(theta);
  const nz = Math.cos(theta);
  return 0.5 + 0.5 * (nx * L.x + nz * L.z) - flat;
}

// --- the tile --------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// The paper's thickness in css px at this wingspan. Kept in one place because
// the bevel, the crease and the layer shadow all have to agree about it.
function bevel(scale: number): { width: number; offset: number } {
  const R = BUTTERFLY.render;
  return {
    width: clamp(scale * R.edgeWidthFactor, R.edgeWidthPx[0], R.edgeWidthPx[1]),
    offset: clamp(scale * R.edgeOffsetFactor, R.edgeOffsetPx[0], R.edgeOffsetPx[1]),
  };
}

// One tile box per creature, covering *every* pose it will ever be drawn in.
// A per-phase box would be tighter, but then the blit offset would move as the
// wings beat and the butterfly would swim inside its own footprint.
function boxFor(spec: ButterflySpec): Box {
  const key = `${spec.id}|${spec.version}`;
  const cached = boxes.get(key);
  if (cached) return cached;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const eat = (x: number, y: number, pad = 0) => {
    if (x - pad < minX) minX = x - pad;
    if (y - pad < minY) minY = y - pad;
    if (x + pad > maxX) maxX = x + pad;
    if (y + pad > maxY) maxY = y + pad;
  };

  for (const pose of poses) {
    for (const panel of spec.panels) {
      const theta = panel.kind === "fore" ? pose.fore : pose.hind;
      for (const p of panel.outline) {
        const q = project(p, theta);
        eat(q.x, q.y);
      }
    }
  }
  // body and antennae sit on the fold, where the projection is the identity
  for (const p of spec.body.outline) eat(p.x, p.y);
  for (const a of spec.antennae) for (const p of a.points) eat(p.x, p.y, a.clubR);

  const box = { minX, minY, maxX, maxY };
  boxes.set(key, box);
  return box;
}

function buildTile(
  spec: ButterflySpec,
  palette: Palette,
  scale: number,
  dpr: number,
  pose: WingPose,
  look: DepthLook,
): Tile {
  const R = BUTTERFLY.render;
  const S = R.shadow;
  // The depth multiplier is applied *after* the clamp, so it is a plain
  // multiply rather than something the floor can eat. It has to be: the shadow
  // is sized off the wingspan, a far butterfly is smaller, and left alone its
  // shadow would tighten with distance — exactly backwards. Near planes cast
  // tight dark contact shadows; far ones cast long, wide, faint ones, which is
  // how a tunnel book says "there is air behind this sheet".
  const blur = clamp(scale * S.blurFactor, S.minBlur, S.maxBlur) * look.shadowScale;
  const drop = clamp(scale * S.offsetFactor, S.minOffset, S.maxOffset) * look.shadowScale;
  const pad = blur + drop + 2;

  const e = boxFor(spec);
  const cssW = (e.maxX - e.minX) * scale + pad * 2;
  const cssH = (e.maxY - e.minY) * scale + pad * 2;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(cssW * dpr));
  canvas.height = Math.max(1, Math.ceil(cssH * dpr));
  const ctx = canvas.getContext("2d")!;

  // Paths are built straight in device pixels, so shadow blur and line widths
  // mean what they say. (Canvas shadow offsets ignore the transform, and
  // fighting that is more trouble than a two-line mapping function.)
  const P = (p: Pt) => ({
    x: ((p.x - e.minX) * scale + pad) * dpr,
    y: ((p.y - e.minY) * scale + pad) * dpr,
  });
  const px = (v: number) => v * dpr;

  const angleOf = (panel: WingPanel) => (panel.kind === "fore" ? pose.fore : pose.hind);

  const L = lightDir();
  const L3 = light3();
  const flatLit = 0.5 + 0.5 * L3.z;

  const panelPaths = spec.panels.map((panel) => {
    const theta = angleOf(panel);
    // A cut seen at an angle is narrower than a cut seen flat, so the
    // level-of-detail threshold has to foreshorten with the paper. Holes
    // closing up as a wing turns edge-on is what punched paper does.
    const squeeze = Math.max(0.25, Math.abs(Math.cos(theta)));
    return pathOf(panel, (p) => P(project(p, theta)), BUTTERFLY.lod.minCutPx / (scale * squeeze));
  });
  const bodyPath = polyPath(spec.body.outline, P);

  // 1. the cast shadow onto the sheet below — holes and all, because light goes
  //    through a punched hole and leaves a bright dot in the shadow
  const union = new Path2D();
  for (const p of panelPaths) union.addPath(p);
  union.addPath(bodyPath);
  paintShadow(
    ctx,
    union,
    canvas.width,
    px(-L.x * drop),
    px(-L.y * drop),
    px(blur),
    R.shadow.alpha * look.shadowAlpha,
  );

  // 2. the dyed stock this creature was cut from, and where in the sheet its
  //    piece came from
  const dye = dyeFor(palette, dpr);
  const h = hashString(spec.id);
  const dyeAt = { x: h % dye.width, y: (h >>> 11) % dye.height };

  const hindPaths = spec.panels.map((p, i) => (p.kind === "hind" ? panelPaths[i] : null));

  spec.panels.forEach((panel, i) => {
    // the forewing is a separate layer of paper sitting on the hindwing, and
    // says so by dropping a small hard-edged shadow onto it
    if (panel.kind === "fore") {
      for (let j = 0; j < spec.panels.length; j++) {
        const under = hindPaths[j];
        if (!under || spec.panels[j].side !== panel.side) continue;
        const lift = clamp(scale * R.layerShadowFactor, 0.5, 2.4);
        ctx.save();
        ctx.clip(under);
        ctx.translate(px(-L.x * lift), px(-L.y * lift));
        ctx.fillStyle = rgba(palette.dark, R.layerShadowAlpha);
        ctx.fill(panelPaths[i]);
        ctx.restore();
      }
    }
    paintPanel(ctx, panel, panelPaths[i], angleOf(panel), dye, dyeAt, palette, scale, P, px, L, L3, flatLit);
  });

  // 3. the body, folded along the same ridge
  paintBody(ctx, spec, bodyPath, dye, dyeAt, palette, scale, P, px, L);

  // 4. the mountain fold itself, over everything it runs through
  if (scale >= BUTTERFLY.lod.creaseAbovePx) {
    const all = new Path2D();
    for (const p of panelPaths) all.addPath(p);
    all.addPath(bodyPath);
    paintCrease(ctx, spec, all, palette, scale, P, px, L);
  }

  // 5. antennae — the first thing to go when the creature is far away
  if (scale >= BUTTERFLY.lod.antennaeAbovePx) {
    paintAntennae(ctx, spec, palette, scale, P, px, L);
  }

  // 6. the air in between. `source-atop` is the whole trick: it mixes toward
  //    the sheet's cream wherever the tile already has paper and leaves the
  //    transparent surround alone, so the result is a straight lerp,
  //    c' = haze·cream + (1 - haze)·c, with the alpha channel untouched.
  //
  //    One operation, and it does both halves of aerial perspective at once —
  //    the hue slides toward the sheet and the contrast compresses against it,
  //    because the darks are lifted much further than the lights are lowered.
  //    The cast shadow is under the same wash, which is right: it is behind the
  //    same air as the creature that threw it.
  if (look.haze > 0) {
    ctx.save();
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = rgba(PAPER.aerial, Math.min(1, look.haze));
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  return {
    canvas,
    cssW,
    cssH,
    ox: -(pad - e.minX * scale),
    oy: -(pad - e.minY * scale),
    bytes: canvas.width * canvas.height * 4,
  };
}

// --- paths -----------------------------------------------------------------

function polyPath(poly: Pt[], P: (p: Pt) => Pt): Path2D {
  const path = new Path2D();
  const first = P(poly[0]);
  path.moveTo(first.x, first.y);
  for (let i = 1; i < poly.length; i++) {
    const q = P(poly[i]);
    path.lineTo(q.x, q.y);
  }
  path.closePath();
  return path;
}

// Outline plus every cut that survives the level-of-detail threshold. Windings
// are canonical in the spec, so nonzero fill punches the cuts and unions the
// overlapping panels at the same time.
function pathOf(panel: WingPanel, P: (p: Pt) => Pt, minCutR: number): Path2D {
  const path = polyPath(panel.outline, P);
  for (const cut of panel.cuts) {
    if (cut.r < minCutR) continue;
    path.addPath(polyPath(cut.points, P));
  }
  return path;
}

// --- painting --------------------------------------------------------------

// Canvas will not paint a shadow without painting its caster, so the caster is
// drawn far off-canvas and the shadow offset brings only the shadow back.
function paintShadow(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  canvasWidth: number,
  dx: number,
  dy: number,
  blur: number,
  alpha: number,
): void {
  const far = canvasWidth + 400;
  ctx.save();
  ctx.shadowColor = rgba([32, 24, 16], alpha);
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = dx + far;
  ctx.shadowOffsetY = dy;
  ctx.translate(-far, 0);
  ctx.fillStyle = "#000";
  ctx.fill(path);
  ctx.restore();
}

// One swatch of dyed stock per paper, generated once and shared by every
// creature, every wingbeat phase and every wingspan.
//
// It is shared because it is *true*: they are all cut from the same sheet. Each
// butterfly takes its own patch of it, keyed off the id, so no two show the same
// fibre in the same place — the sheet is common, the piece is not.
//
// Colour field, low-frequency mottle, and micro-relief lit from the same angle
// as everything else. Grain is fixed in css px rather than unit space, so a
// small butterfly does not get an implausibly fine tooth that aliases into mush.
function dyeFor(palette: Palette, dpr: number): HTMLCanvasElement {
  const key = `${palette.key}|${dpr.toFixed(2)}`;
  const cached = dyes.get(key);
  if (cached) return cached;

  const R = BUTTERFLY.render;
  const w = Math.max(1, Math.round(R.dyeSwatchPx * dpr));
  const h = w;
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  const tctx = tmp.getContext("2d")!;
  const img = tctx.createImageData(w, h);
  const data = img.data;

  const L = lightDir();
  const seed = hashString(palette.key) >>> 8;
  const [b0, b1, b2] = palette.base;
  const STEP = 1.2;

  for (let j = 0; j < h; j++) {
    const cy = j / dpr;
    for (let i = 0; i < w; i++) {
      const cx = i / dpr;
      const mottle = (fbm(cx / R.grainScalePx, cy / R.grainScalePx, seed, 2) - 0.5) * R.grainAmount;
      const h0 = fbm(cx / R.reliefScalePx, cy / R.reliefScalePx, seed + 7, 2);
      const hX = fbm((cx + STEP) / R.reliefScalePx, cy / R.reliefScalePx, seed + 7, 2);
      const hY = fbm(cx / R.reliefScalePx, (cy + STEP) / R.reliefScalePx, seed + 7, 2);
      const relief = -(L.x * (hX - h0) + L.y * (hY - h0)) * R.reliefAmp;
      const d = mottle + relief;
      const idx = (j * w + i) * 4;
      data[idx] = clamp(b0 + d, 0, 255);
      data[idx + 1] = clamp(b1 + d, 0, 255);
      data[idx + 2] = clamp(b2 + d, 0, 255);
      data[idx + 3] = 255;
    }
  }
  tctx.putImageData(img, 0, 0);
  dyes.set(key, tmp);
  dyeBytes += w * h * 4;
  return tmp;
}

// Tile the swatch from a per-creature offset so it covers the requested rect.
// At every wingspan this app draws, one blit covers it; the loop is here for
// the day something is drawn larger than the swatch.
function fillDye(
  ctx: CanvasRenderingContext2D,
  dye: HTMLCanvasElement,
  at: { x: number; y: number },
  x0: number,
  y0: number,
  w: number,
  h: number,
): void {
  const dw = dye.width;
  const dh = dye.height;
  for (let y = y0 - (at.y % dh); y < y0 + h; y += dh) {
    for (let x = x0 - (at.x % dw); x < x0 + w; x += dw) {
      ctx.drawImage(dye, x, y);
    }
  }
}

type Mapper = (p: Pt) => Pt;
type Scaler = (v: number) => number;

function paintPanel(
  ctx: CanvasRenderingContext2D,
  panel: WingPanel,
  path: Path2D,
  theta: number,
  dye: HTMLCanvasElement,
  dyeAt: { x: number; y: number },
  palette: Palette,
  scale: number,
  P: Mapper,
  px: Scaler,
  L: { x: number; y: number },
  L3: { x: number; y: number; z: number },
  flatLit: number,
): void {
  const R = BUTTERFLY.render;
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.save();
  ctx.clip(path);

  // The grain foreshortens with the paper it is printed on. Squeezing the dye
  // about the fold by the same cosine as the geometry is what stops the fibre
  // sliding across a wing that is turning — the one place a shared swatch could
  // have given the game away.
  const cos = Math.max(0.12, Math.abs(Math.cos(theta)));
  const foldX = P({ x: 0, y: 0 }).x;
  ctx.save();
  ctx.translate(foldX, 0);
  ctx.scale(cos, 1);
  ctx.translate(-foldX, 0);
  const inv = 1 / cos;
  const x0 = foldX + (0 - foldX) * inv;
  const x1 = foldX + (w - foldX) * inv;
  fillDye(ctx, dye, dyeAt, x0, 0, x1 - x0, h);
  ctx.restore();

  // How this panel is holding itself against the key light. Strongest at the
  // ridge, easing off toward the tip — flat panels, but the paper never lies
  // quite flat.
  let shade = panelShade(panel.side, theta, L3, flatLit);
  if (panel.kind === "hind") shade -= R.panelSplit;
  const tint: RGB = shade > 0 ? [255, 252, 244] : [30, 22, 14];
  const a = Math.min(R.foldMaxAlpha, R.foldContrast * Math.pow(Math.abs(shade), R.foldGamma));
  const ridge = P(project({ x: 0, y: 0 }, theta));
  const outer = P(project({ x: panel.side * 0.5, y: 0 }, theta));
  const grad = ctx.createLinearGradient(ridge.x, ridge.y, outer.x, outer.y);
  grad.addColorStop(0, rgba(tint, Math.min(0.85, a * 1.5)));
  grad.addColorStop(1, rgba(tint, a * 0.45));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  if (scale >= BUTTERFLY.lod.edgeAbovePx) {
    strokeThickness(ctx, path, palette, scale, px, L);
  } else {
    // too small for a bevel; a single dark hairline keeps the silhouette crisp
    ctx.lineWidth = px(0.6);
    ctx.strokeStyle = rgba(palette.dark, 0.5);
    ctx.stroke(path);
  }
  ctx.restore();
}

// Paper thickness. The path is stroked twice, offset away from and toward the
// key light; the clip keeps only the half that lands on paper. On the outer
// silhouette that puts the pale rim on the lit side; inside a punched hole the
// geometry inverts and puts it on the far side, which is exactly right — you
// are seeing the inside of the cut wall.
function strokeThickness(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  palette: Palette,
  scale: number,
  px: Scaler,
  L: { x: number; y: number },
): void {
  const R = BUTTERFLY.render;
  const b = bevel(scale);
  const off = px(b.offset);
  // doubled: the clip eats the outward half of every stroke
  ctx.lineWidth = px(b.width) * 2;
  ctx.lineJoin = "round";

  ctx.save();
  ctx.translate(L.x * off, L.y * off);
  ctx.strokeStyle = rgba(palette.dark, R.darkAlpha);
  ctx.stroke(path);
  ctx.restore();

  ctx.save();
  ctx.translate(-L.x * off, -L.y * off);
  ctx.strokeStyle = rgba(palette.lit, R.litAlpha);
  ctx.stroke(path);
  ctx.restore();
}

function paintBody(
  ctx: CanvasRenderingContext2D,
  spec: ButterflySpec,
  path: Path2D,
  dye: HTMLCanvasElement,
  dyeAt: { x: number; y: number },
  palette: Palette,
  scale: number,
  P: Mapper,
  px: Scaler,
  L: { x: number; y: number },
): void {
  ctx.save();
  ctx.clip(path);
  fillDye(ctx, dye, dyeAt, 0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = rgba(palette.body, 0.72);
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  if (scale >= BUTTERFLY.lod.creaseAbovePx) {
    ctx.lineWidth = px(0.6);
    ctx.strokeStyle = rgba(palette.dark, 0.4);
    for (const y of spec.body.segments) {
      const a = P({ x: -0.06, y });
      const b = P({ x: 0.06, y });
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
  if (scale >= BUTTERFLY.lod.edgeAbovePx) {
    strokeThickness(ctx, path, palette, scale, px, L);
  }
  ctx.restore();
}

// The mountain fold. A ridge, not a cut: the pale line sits on the side facing
// the light and the dark line on the far side — the opposite sense to a cut
// edge, and the reason the creature reads as folded rather than assembled.
//
// The fold is the hinge, so it is the one line the wingbeat never moves.
function paintCrease(
  ctx: CanvasRenderingContext2D,
  spec: ButterflySpec,
  clipPath: Path2D,
  palette: Palette,
  scale: number,
  P: Mapper,
  px: Scaler,
  L: { x: number; y: number },
): void {
  const top = P({ x: 0, y: spec.fold.top });
  const bot = P({ x: 0, y: spec.fold.bottom });
  const b = bevel(scale);
  const off = px(b.offset);
  ctx.save();
  ctx.clip(clipPath);
  ctx.lineWidth = px(b.width);
  ctx.lineCap = "round";

  ctx.strokeStyle = rgba(palette.dark, BUTTERFLY.render.creaseAlpha);
  ctx.beginPath();
  ctx.moveTo(top.x - L.x * off, top.y);
  ctx.lineTo(bot.x - L.x * off, bot.y);
  ctx.stroke();

  ctx.strokeStyle = rgba(palette.lit, BUTTERFLY.render.creaseAlpha * 1.15);
  ctx.beginPath();
  ctx.moveTo(top.x + L.x * off, top.y);
  ctx.lineTo(bot.x + L.x * off, bot.y);
  ctx.stroke();
  ctx.restore();
}

function paintAntennae(
  ctx: CanvasRenderingContext2D,
  spec: ButterflySpec,
  palette: Palette,
  scale: number,
  P: Mapper,
  px: Scaler,
  L: { x: number; y: number },
): void {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const w = clamp(scale * 0.007, 0.5, 1.3);
  for (const a of spec.antennae) {
    const pts = a.points.map(P);
    const club = pts[pts.length - 1];
    const r = px(a.clubR * scale);
    for (const pass of [
      { dx: -L.x * px(w * 0.6), dy: -L.y * px(w * 0.6), colour: palette.lit, alpha: 0.4, w: px(w) },
      { dx: 0, dy: 0, colour: palette.body, alpha: 0.9, w: px(w * 0.85) },
    ]) {
      ctx.strokeStyle = rgba(pass.colour, pass.alpha);
      ctx.fillStyle = rgba(pass.colour, pass.alpha);
      ctx.lineWidth = pass.w;
      ctx.beginPath();
      ctx.moveTo(pts[0].x + pass.dx, pts[0].y + pass.dy);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x + pass.dx, pts[i].y + pass.dy);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(club.x + pass.dx, club.y + pass.dy, Math.max(px(0.8), r), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
