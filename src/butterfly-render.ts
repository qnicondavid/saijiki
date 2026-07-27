// The butterfly's phenotype: draw a spec. This module knows nothing about ids.
//
// Step 7 will want to draw dozens of these per frame, so the static art is
// baked once into an offscreen tile and blitted afterwards. The cache key is
// spec + palette + scale (+ dpr), which is the complete set of inputs — if
// anything else could change the picture, this cache would be a bug.
//
// Every boundary in here is a *cut*, and cut paper has thickness. That is what
// the two offset strokes do: a pale rim where the cut wall turns toward the
// key light, a dark one where it turns away. Offsetting the whole even-odd
// path and keeping only what lands on paper gets both the outer silhouette and
// the punched holes right in a single pass, with opposite sense, for free.

import { BUTTERFLY, type ButterflySpec, type Pt, type WingPanel } from "./butterfly";
import { fbm } from "./noise";
import { PAPER } from "./paper";
import type { Palette } from "./papers";

type RGB = [number, number, number];

const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// PAPER.light.angleDeg points *toward* the source, so this vector points at the
// light and its negation is the direction shadows fall. The butterfly borrows
// the diorama's lighting rather than inventing its own — nothing sells layered
// paper faster than two objects disagreeing about where the sun is.
function lightDir(): { x: number; y: number } {
  const rad = (PAPER.light.angleDeg * Math.PI) / 180;
  return { x: Math.cos(rad), y: Math.sin(rad) };
}

interface Tile {
  canvas: HTMLCanvasElement;
  cssW: number;
  cssH: number;
  ox: number; // blit offset from the butterfly's unit origin
  oy: number;
}

const tiles = new Map<string, Tile>();

/**
 * Draw `spec` centred on its unit origin at (x, y), `scale` css px per unit —
 * which, since the wingspan is one unit, is the wingspan in css px.
 *
 * Device pixel ratio is read off the context's current transform, matching how
 * main.ts sets it up. Nothing here reads global state otherwise.
 */
export function renderButterfly(
  ctx: CanvasRenderingContext2D,
  spec: ButterflySpec,
  palette: Palette,
  x: number,
  y: number,
  scale: number,
): void {
  const dpr = ctx.getTransform().a || 1;
  const key = `${spec.id}|${spec.version}|${palette.key}|${scale.toFixed(2)}|${dpr.toFixed(2)}`;
  let tile = tiles.get(key);
  if (!tile) {
    tile = buildTile(spec, palette, scale, dpr);
    if (tiles.size >= BUTTERFLY.cacheSize) {
      // insertion order: drop the oldest
      const oldest = tiles.keys().next().value;
      if (oldest !== undefined) tiles.delete(oldest);
    }
    tiles.set(key, tile);
  }
  ctx.drawImage(tile.canvas, x + tile.ox, y + tile.oy, tile.cssW, tile.cssH);
}

export function clearButterflyCache(): void {
  tiles.clear();
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

function buildTile(spec: ButterflySpec, palette: Palette, scale: number, dpr: number): Tile {
  const R = BUTTERFLY.render;
  const S = R.shadow;
  const blur = clamp(scale * S.blurFactor, S.minBlur, S.maxBlur);
  const drop = clamp(scale * S.offsetFactor, S.minOffset, S.maxOffset);
  const pad = blur + drop + 2;

  const e = spec.extent;
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

  const L = lightDir();
  const minCutR = BUTTERFLY.lod.minCutPx / scale;

  const panelPaths = spec.panels.map((panel) => pathOf(panel, P, minCutR));
  const bodyPath = polyPath(spec.body.outline, P);

  // 1. the cast shadow onto the sheet below — holes and all, because light goes
  //    through a punched hole and leaves a bright dot in the shadow
  const union = new Path2D();
  for (const p of panelPaths) union.addPath(p);
  union.addPath(bodyPath);
  paintShadow(ctx, union, canvas.width, px(-L.x * drop), px(-L.y * drop), px(blur));

  // 2. one sheet of dyed paper for the whole creature, then each panel clips
  //    its own piece out of it
  const texture = paperTexture(spec, palette, canvas.width, canvas.height, dpr);

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
    paintPanel(ctx, panel, panelPaths[i], texture, palette, scale, P, px, L);
  });

  // 3. the body, folded along the same ridge
  paintBody(ctx, spec, bodyPath, texture, palette, scale, P, px, L);

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

  return { canvas, cssW, cssH, ox: -(pad - e.minX * scale), oy: -(pad - e.minY * scale) };
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
): void {
  const far = canvasWidth + 400;
  ctx.save();
  ctx.shadowColor = rgba([32, 24, 16], BUTTERFLY.render.shadow.alpha);
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = dx + far;
  ctx.shadowOffsetY = dy;
  ctx.translate(-far, 0);
  ctx.fillStyle = "#000";
  ctx.fill(path);
  ctx.restore();
}

// The dyed sheet: colour field, low-frequency mottle, and micro-relief lit from
// the same angle as everything else. Grain is fixed in css px rather than unit
// space, so a small butterfly does not get an implausibly fine tooth that
// aliases into mush.
function paperTexture(
  spec: ButterflySpec,
  palette: Palette,
  w: number,
  h: number,
  dpr: number,
): HTMLCanvasElement {
  const R = BUTTERFLY.render;
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  const tctx = tmp.getContext("2d")!;
  const img = tctx.createImageData(w, h);
  const data = img.data;

  const L = lightDir();
  const seed = spec.version * 7919 + spec.id.length * 131;
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
  return tmp;
}

type Mapper = (p: Pt) => Pt;
type Scaler = (v: number) => number;

function paintPanel(
  ctx: CanvasRenderingContext2D,
  panel: WingPanel,
  path: Path2D,
  texture: HTMLCanvasElement,
  palette: Palette,
  scale: number,
  P: Mapper,
  px: Scaler,
  L: { x: number; y: number },
): void {
  const R = BUTTERFLY.render;
  ctx.save();
  ctx.clip(path);
  ctx.drawImage(texture, 0, 0);

  // How this half of the fold faces the light. Strongest at the ridge, easing
  // off toward the tip — flat panels, but the paper never lies quite flat.
  const shade =
    panel.facing * L.x * R.foldContrast - (panel.kind === "hind" ? R.panelSplit : 0);
  const tint: RGB = shade > 0 ? [255, 252, 244] : [30, 22, 14];
  const a = Math.abs(shade);
  const ridge = P({ x: 0, y: 0 });
  const outer = P({ x: panel.side * 0.5, y: 0 });
  const grad = ctx.createLinearGradient(ridge.x, ridge.y, outer.x, outer.y);
  grad.addColorStop(0, rgba(tint, Math.min(0.85, a * 1.5)));
  grad.addColorStop(1, rgba(tint, a * 0.45));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

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
  texture: HTMLCanvasElement,
  palette: Palette,
  scale: number,
  P: Mapper,
  px: Scaler,
  L: { x: number; y: number },
): void {
  ctx.save();
  ctx.clip(path);
  ctx.drawImage(texture, 0, 0);
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
