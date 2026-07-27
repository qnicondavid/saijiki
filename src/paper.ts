// The diorama's back wall: a shallow box, seen straight on, with a single sheet
// of handmade cream paper lying against it. No butterflies, no animation — this
// is the empty state, and it has to be lovely on its own.
//
// Everything is drawn once into an offscreen canvas and blitted each frame; it
// regenerates only when the size, DPR, or active variant actually changes. All
// tunable constants live in the exported PAPER object below.
//
// Canvas 2D only. Soft shadows here are genuine cast shadows (the object on the
// desktop, the sheet on the box floor, the box walls occluding their own
// interior) — not blur standing in for the tunnel-book depth described in the
// constitution. There is one paper plane, so there is no inter-layer depth to
// fake.

import { fbm, mulberry32 } from "./noise";

export interface PaperVariant {
  name: string;
  seed: number;
  // warm off-white base, before mottling and lighting
  base: [number, number, number];
  lumRange: number; // ± luminance mottle across the sheet
  warmRange: number; // ± warmth (pushes red up / blue down, or the reverse)
  mottleScale: number; // css px per mottle-noise unit — larger = broader blooms
  fibreDensity: number; // embedded fibres per 1000 css px²
  fibreLength: number; // css px
  fibreLengthJitter: number;
  fibreAlpha: number;
  reliefAmp: number; // strength of the micro-relief (tooth) shading
  reliefScale: number; // css px per relief-noise unit
}

export const PAPER = {
  // the object's silhouette, inset from the transparent window so its drop
  // shadow has room to fall (more room at the bottom, where it lands)
  object: { marginX: 18, marginTop: 14, marginBottom: 26, cornerRadius: 20 },

  wall: 13, // box rim thickness
  wallCornerRadius: 12,
  sheetInset: 14, // gap from box interior to the paper's edge
  sheetCornerRadius: 8,

  // the sheet is very slightly warped, so its edges are not perfectly straight
  warp: { amount: 2.6, scale: 30 },

  // soft key light from the upper left. angleDeg points toward the source in
  // screen space (y down), so 225° is up-and-to-the-left.
  light: { angleDeg: 225, keyStrength: 9 },

  tooth: { density: 1.1, alpha: 0.05 },

  rim: {
    colour: [216, 207, 190] as [number, number, number],
    topLight: 0.16, // white lift at the upper-left rim
    bottomDark: 0.2, // shadow at the lower-right rim
  },
  interior: [174, 163, 144] as [number, number, number], // recessed floor around the sheet

  dropShadow: { blur: 18, offsetX: 0, offsetY: 8, colour: "rgba(26,20,12,0.32)" },
  contactShadow: { blur: 6, offsetX: 2, offsetY: 3, colour: "rgba(38,28,16,0.30)" },
  deckle: { colour: [122, 104, 78] as [number, number, number], alpha: 0.16 },

  // gentle inner vignette from the box walls, strongest at the lower right
  vignette: { strength: 0.24, colour: [58, 46, 30] as [number, number, number] },

  // faint watermark crease pattern — see drawCreasePattern
  crease: { colour: [116, 100, 76] as [number, number, number], alpha: 0.07 },

  variants: [
    {
      name: "kozo",
      seed: 1337,
      base: [239, 231, 214],
      lumRange: 12,
      warmRange: 9,
      mottleScale: 46,
      fibreDensity: 1.7,
      fibreLength: 7,
      fibreLengthJitter: 4,
      fibreAlpha: 0.1,
      reliefAmp: 130,
      reliefScale: 26,
    },
    {
      name: "gampi",
      seed: 4242,
      base: [243, 237, 224],
      lumRange: 8,
      warmRange: 6,
      mottleScale: 62,
      fibreDensity: 1.0,
      fibreLength: 5,
      fibreLengthJitter: 3,
      fibreAlpha: 0.07,
      reliefAmp: 92,
      reliefScale: 34,
    },
    {
      name: "cotton",
      seed: 90210,
      base: [236, 227, 209],
      lumRange: 14,
      warmRange: 7,
      mottleScale: 40,
      fibreDensity: 2.3,
      fibreLength: 5,
      fibreLengthJitter: 3,
      fibreAlpha: 0.09,
      reliefAmp: 118,
      reliefScale: 22,
    },
    {
      name: "buff",
      seed: 55,
      base: [233, 219, 196],
      lumRange: 15,
      warmRange: 12,
      mottleScale: 37,
      fibreDensity: 2.0,
      fibreLength: 8,
      fibreLengthJitter: 5,
      fibreAlpha: 0.11,
      reliefAmp: 150,
      reliefScale: 24,
    },
  ] as PaperVariant[],

  active: 0,
};

// --- geometry -------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

interface Geometry {
  box: Rect; // rim outer edge
  inner: Rect; // box interior / floor opening
  sheet: Rect; // the paper, before warping
}

function computeGeometry(cssW: number, cssH: number): Geometry {
  const o = PAPER.object;
  const box: Rect = {
    x: o.marginX,
    y: o.marginTop,
    w: cssW - o.marginX * 2,
    h: cssH - o.marginTop - o.marginBottom,
    r: o.cornerRadius,
  };
  const inner: Rect = {
    x: box.x + PAPER.wall,
    y: box.y + PAPER.wall,
    w: box.w - PAPER.wall * 2,
    h: box.h - PAPER.wall * 2,
    r: PAPER.wallCornerRadius,
  };
  const sheet: Rect = {
    x: inner.x + PAPER.sheetInset,
    y: inner.y + PAPER.sheetInset,
    w: inner.w - PAPER.sheetInset * 2,
    h: inner.h - PAPER.sheetInset * 2,
    r: PAPER.sheetCornerRadius,
  };
  return { box, inner, sheet };
}

function roundRectPath(ctx: PathTarget, rc: Rect): void {
  const { x, y, w, h } = rc;
  const r = Math.min(rc.r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

interface PathTarget {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  closePath(): void;
}

interface Pt {
  x: number;
  y: number;
}

// Sample a rounded-rect perimeter and displace each point along its outward
// normal by low-frequency noise — a gently deckled, slightly warped edge.
function warpedOutline(rc: Rect, warp: number, scale: number, seed: number): Pt[] {
  const r = Math.min(rc.r, rc.w / 2, rc.h / 2);
  const pts: Pt[] = [];
  const push = (px: number, py: number, nx: number, ny: number) => {
    const d = (fbm(px / scale, py / scale, seed, 2) - 0.5) * 2 * warp;
    pts.push({ x: px + nx * d, y: py + ny * d });
  };
  const edgeStep = 6; // css px between samples on straight edges
  const cornerSteps = 6;

  const { x, y, w, h } = rc;
  // top edge (normal up)
  for (let px = x + r; px < x + w - r; px += edgeStep) push(px, y, 0, -1);
  // top-right corner
  for (let i = 0; i <= cornerSteps; i++) {
    const a = -Math.PI / 2 + (i / cornerSteps) * (Math.PI / 2);
    push(x + w - r + Math.cos(a) * r, y + r + Math.sin(a) * r, Math.cos(a), Math.sin(a));
  }
  // right edge (normal right)
  for (let py = y + r; py < y + h - r; py += edgeStep) push(x + w, py, 1, 0);
  // bottom-right corner
  for (let i = 0; i <= cornerSteps; i++) {
    const a = (i / cornerSteps) * (Math.PI / 2);
    push(x + w - r + Math.cos(a) * r, y + h - r + Math.sin(a) * r, Math.cos(a), Math.sin(a));
  }
  // bottom edge (normal down)
  for (let px = x + w - r; px > x + r; px -= edgeStep) push(px, y + h, 0, 1);
  // bottom-left corner
  for (let i = 0; i <= cornerSteps; i++) {
    const a = Math.PI / 2 + (i / cornerSteps) * (Math.PI / 2);
    push(x + r + Math.cos(a) * r, y + h - r + Math.sin(a) * r, Math.cos(a), Math.sin(a));
  }
  // left edge (normal left)
  for (let py = y + h - r; py > y + r; py -= edgeStep) push(x, py, -1, 0);
  // top-left corner
  for (let i = 0; i <= cornerSteps; i++) {
    const a = Math.PI + (i / cornerSteps) * (Math.PI / 2);
    push(x + r + Math.cos(a) * r, y + r + Math.sin(a) * r, Math.cos(a), Math.sin(a));
  }
  return pts;
}

function tracePath(ctx: PathTarget, pts: Pt[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

// --- the sheet texture ----------------------------------------------------

function clamp8(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// Paint the paper's colour field + micro-relief lighting into a device-pixel
// canvas covering `rect`. Noise is sampled in css space so the look is
// DPR-independent. Fibres and tooth are added later as crisp vector strokes.
function paintTexture(v: PaperVariant, rect: Rect, dpr: number): HTMLCanvasElement {
  const pw = Math.max(1, Math.round(rect.w * dpr));
  const ph = Math.max(1, Math.round(rect.h * dpr));
  const tmp = document.createElement("canvas");
  tmp.width = pw;
  tmp.height = ph;
  const tctx = tmp.getContext("2d")!;
  const img = tctx.createImageData(pw, ph);
  const data = img.data;

  const rad = (PAPER.light.angleDeg * Math.PI) / 180;
  const sx = Math.cos(rad);
  const sy = Math.sin(rad);
  const key = PAPER.light.keyStrength;
  const [b0, b1, b2] = v.base;
  const STEP = 1.5;

  for (let j = 0; j < ph; j++) {
    const cy = rect.y + j / dpr;
    const ty = j / (ph - 1 || 1);
    for (let i = 0; i < pw; i++) {
      const cx = rect.x + i / dpr;

      const lum = fbm(cx / v.mottleScale, cy / v.mottleScale, v.seed, 3);
      const warm = fbm((cx + 123) / v.mottleScale, (cy - 77) / v.mottleScale, v.seed + 31, 3);

      // micro-relief: brighten slopes facing the key light, darken those away
      const h0 = fbm(cx / v.reliefScale, cy / v.reliefScale, v.seed + 7, 2);
      const hX = fbm((cx + STEP) / v.reliefScale, cy / v.reliefScale, v.seed + 7, 2);
      const hY = fbm(cx / v.reliefScale, (cy + STEP) / v.reliefScale, v.seed + 7, 2);
      const relief = -(sx * (hX - h0) + sy * (hY - h0)) * v.reliefAmp;

      // broad key ramp: brightest at the upper-left, dimmest at the lower-right
      const tx = i / (pw - 1 || 1);
      const keyRamp = (0.5 - (tx + ty) / 2) * 2 * key;

      const dl = (lum - 0.5) * v.lumRange;
      const dw = (warm - 0.5) * v.warmRange;
      const L = relief + keyRamp + dl;

      const idx = (j * pw + i) * 4;
      data[idx] = clamp8(b0 + L + dw);
      data[idx + 1] = clamp8(b1 + L);
      data[idx + 2] = clamp8(b2 + L - dw);
      data[idx + 3] = 255;
    }
  }
  tctx.putImageData(img, 0, 0);
  return tmp;
}

function drawFibres(ctx: CanvasRenderingContext2D, v: PaperVariant, rect: Rect): void {
  const rng = mulberry32(v.seed ^ 0x9e3779b9);
  const area = rect.w * rect.h;
  const count = Math.round((area / 1000) * v.fibreDensity);
  ctx.lineCap = "round";
  for (let k = 0; k < count; k++) {
    const x = rect.x + rng() * rect.w;
    const y = rect.y + rng() * rect.h;
    const ang = rng() * Math.PI * 2;
    const len = Math.max(1, v.fibreLength + (rng() - 0.5) * 2 * v.fibreLengthJitter);
    const lighter = rng() < 0.55;
    const a = v.fibreAlpha * (0.45 + rng() * 0.8);
    ctx.strokeStyle = lighter ? `rgba(255,251,242,${a})` : `rgba(94,78,56,${a})`;
    ctx.lineWidth = 0.45 + rng() * 0.65;
    // a slight bow so fibres read as pulp, not hatching
    const mx = x + Math.cos(ang) * len * 0.5 + (rng() - 0.5) * 1.4;
    const my = y + Math.sin(ang) * len * 0.5 + (rng() - 0.5) * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(mx, my, x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }
}

function drawTooth(ctx: CanvasRenderingContext2D, v: PaperVariant, rect: Rect): void {
  const rng = mulberry32(v.seed ^ 0x51ed270b);
  const area = rect.w * rect.h;
  const count = Math.round((area / 1000) * PAPER.tooth.density * 4);
  for (let k = 0; k < count; k++) {
    const x = rect.x + rng() * rect.w;
    const y = rect.y + rng() * rect.h;
    const dark = rng() < 0.5;
    const a = PAPER.tooth.alpha * (0.5 + rng());
    ctx.fillStyle = dark ? `rgba(70,58,42,${a})` : `rgba(255,252,246,${a})`;
    const s = 0.5 + rng() * 0.6;
    ctx.fillRect(x, y, s, s);
  }
}

// Faint watermark: the dotted valley/mountain fold lines of a butterfly that
// does not exist yet. Step 6 will replace this geometry with the real fold
// pattern; kept isolated so that swap is contained.
export function drawCreasePattern(ctx: CanvasRenderingContext2D, sheet: Rect): void {
  const cx = sheet.x + sheet.w / 2;
  const cy = sheet.y + sheet.h / 2;
  // keep the pattern within the sheet's central two-thirds
  const halfW = sheet.w * 0.32;
  const top = cy - sheet.h * 0.3;
  const bot = cy + sheet.h * 0.32;
  const [r, g, b] = PAPER.crease.colour;
  const a = PAPER.crease.alpha;
  const valley = `rgba(${r},${g},${b},${a})`; // finely dotted
  const mountain = `rgba(${r},${g},${b},${a * 1.15})`; // dash-dot

  ctx.save();
  ctx.lineWidth = 0.8;
  ctx.lineCap = "round";

  // body / spine — mountain fold down the centre
  ctx.strokeStyle = mountain;
  ctx.setLineDash([4, 3, 1, 3]);
  line(ctx, cx, top, cx, bot);

  // wings, mirrored about the spine
  for (const s of [-1, 1]) {
    const outer = cx + s * halfW;
    // leading edge — valley
    ctx.strokeStyle = valley;
    ctx.setLineDash([1.4, 3]);
    line(ctx, cx, cy - sheet.h * 0.06, outer, top);
    // trailing edge — valley
    line(ctx, cx, cy + sheet.h * 0.06, cx + s * halfW * 0.82, bot);
    // wing tip closing the forewing
    line(ctx, outer, top, cx + s * halfW * 0.82, bot);
    // interior diagonal crease — mountain
    ctx.strokeStyle = mountain;
    ctx.setLineDash([4, 3, 1, 3]);
    line(ctx, cx, cy, cx + s * halfW * 0.62, top + sheet.h * 0.12);
    line(ctx, cx, cy, cx + s * halfW * 0.52, bot - sheet.h * 0.08);
  }

  ctx.restore();
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

// --- assembling the diorama ----------------------------------------------

function fillRGB(ctx: CanvasRenderingContext2D, c: [number, number, number], alpha = 1): void {
  ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

function generateDiorama(cssW: number, cssH: number, dpr: number, v: PaperVariant): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const geo = computeGeometry(cssW, cssH);

  // 1. object drop shadow onto the desktop, plus the rim base fill in one pass
  ctx.save();
  ctx.shadowColor = PAPER.dropShadow.colour;
  ctx.shadowBlur = PAPER.dropShadow.blur;
  ctx.shadowOffsetX = PAPER.dropShadow.offsetX;
  ctx.shadowOffsetY = PAPER.dropShadow.offsetY;
  roundRectPath(ctx, geo.box);
  fillRGB(ctx, PAPER.rim.colour);
  ctx.fill();
  ctx.restore();

  // 2. rim dimensionality — light on the upper-left, shadow on the lower-right
  ctx.save();
  roundRectPath(ctx, geo.box);
  ctx.clip();
  const rimGrad = ctx.createLinearGradient(geo.box.x, geo.box.y, geo.box.x + geo.box.w, geo.box.y + geo.box.h);
  rimGrad.addColorStop(0, `rgba(255,255,255,${PAPER.rim.topLight})`);
  rimGrad.addColorStop(0.5, "rgba(255,255,255,0)");
  rimGrad.addColorStop(1, `rgba(0,0,0,${PAPER.rim.bottomDark})`);
  ctx.fillStyle = rimGrad;
  ctx.fillRect(geo.box.x, geo.box.y, geo.box.w, geo.box.h);
  ctx.restore();

  // 3. recessed interior floor (a darker ring shows around the sheet)
  ctx.save();
  roundRectPath(ctx, geo.inner);
  fillRGB(ctx, PAPER.interior);
  ctx.fill();
  ctx.restore();

  // 4. the paper sheet
  const outline = warpedOutline(geo.sheet, PAPER.warp.amount, PAPER.warp.scale, v.seed + 200);

  // 4a. contact shadow of the sheet against the floor (falls to the lower right)
  ctx.save();
  ctx.shadowColor = PAPER.contactShadow.colour;
  ctx.shadowBlur = PAPER.contactShadow.blur;
  ctx.shadowOffsetX = PAPER.contactShadow.offsetX;
  ctx.shadowOffsetY = PAPER.contactShadow.offsetY;
  tracePath(ctx, outline);
  ctx.fillStyle = "rgba(0,0,0,0.9)";
  ctx.fill();
  ctx.restore();

  // 4b. textured sheet, clipped to the warped silhouette
  const pad = PAPER.warp.amount + 2;
  const texRect: Rect = {
    x: geo.sheet.x - pad,
    y: geo.sheet.y - pad,
    w: geo.sheet.w + pad * 2,
    h: geo.sheet.h + pad * 2,
    r: 0,
  };
  const texture = paintTexture(v, texRect, dpr);

  ctx.save();
  tracePath(ctx, outline);
  ctx.clip();
  ctx.drawImage(texture, texRect.x, texRect.y, texRect.w, texRect.h);
  drawFibres(ctx, v, texRect);
  drawTooth(ctx, v, texRect);
  drawCreasePattern(ctx, geo.sheet);
  // soft inner deckle line, riding the edge from inside
  tracePath(ctx, outline);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = `rgba(${PAPER.deckle.colour[0]},${PAPER.deckle.colour[1]},${PAPER.deckle.colour[2]},${PAPER.deckle.alpha})`;
  ctx.stroke();
  ctx.restore();

  // 5. inner vignette from the box walls, over everything inside, strongest at
  // the lower right (centre pushed to the upper-left so the far corner is darkest)
  ctx.save();
  roundRectPath(ctx, geo.inner);
  ctx.clip();
  const vcx = geo.inner.x + geo.inner.w * 0.34;
  const vcy = geo.inner.y + geo.inner.h * 0.32;
  const vr = Math.hypot(geo.inner.w * 0.7, geo.inner.h * 0.72);
  const vig = ctx.createRadialGradient(vcx, vcy, vr * 0.35, vcx, vcy, vr);
  const [vR, vG, vB] = PAPER.vignette.colour;
  vig.addColorStop(0, `rgba(${vR},${vG},${vB},0)`);
  vig.addColorStop(0.7, `rgba(${vR},${vG},${vB},0)`);
  vig.addColorStop(1, `rgba(${vR},${vG},${vB},${PAPER.vignette.strength})`);
  ctx.fillStyle = vig;
  ctx.fillRect(geo.inner.x, geo.inner.y, geo.inner.w, geo.inner.h);
  ctx.restore();

  return canvas;
}

// --- public: cached blit + variant control --------------------------------

interface Cache {
  canvas: HTMLCanvasElement;
  cssW: number;
  cssH: number;
  dpr: number;
  variant: number;
}

let cache: Cache | null = null;

export function drawScene(ctx: CanvasRenderingContext2D, cssW: number, cssH: number, dpr: number): void {
  if (
    !cache ||
    cache.cssW !== cssW ||
    cache.cssH !== cssH ||
    cache.dpr !== dpr ||
    cache.variant !== PAPER.active
  ) {
    cache = {
      canvas: generateDiorama(cssW, cssH, dpr, PAPER.variants[PAPER.active]),
      cssW,
      cssH,
      dpr,
      variant: PAPER.active,
    };
  }
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.drawImage(cache.canvas, 0, 0, cssW, cssH);
}

// Where the sheet lies, in css px. Anything that sits *on* the paper — the
// butterflies, the dev gallery — needs this to know its bounds.
export function sheetRect(cssW: number, cssH: number): Rect {
  return computeGeometry(cssW, cssH).sheet;
}

export function cycleVariant(): void {
  PAPER.active = (PAPER.active + 1) % PAPER.variants.length;
}

export function getActiveVariantName(): string {
  return PAPER.variants[PAPER.active].name;
}
