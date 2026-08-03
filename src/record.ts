// Recording. The ceremony this whole application is built around.
//
// CLAUDE.md: "Rare and deliberate. Click the scissors, a blank slip appears,
// write one line, pick a paper. On confirm the slip is cut out of the back
// sheet — leaving its silhouette behind as a permanent hole — folds itself into
// a flat square, and settles at the bottom of the box."
//
// Every part of that sentence is load-bearing, and the order is too. The entry
// is written to disk *first*, because the writing is what makes it real and
// everything after it is only what that looks like; then the sheet is cut,
// because the creature has to come from somewhere; then the slip folds, because
// it is not a butterfly yet and will not be until tomorrow.
//
// --- what is deliberately absent ---------------------------------------------
//
// No confirmation, no toast, no badge, no count, nothing congratulating anyone.
// The ceremony is the feedback: you watched the paper get cut and folded, and
// there is now a small square at the bottom of the box that was not there
// before. An "entry saved" message would be the app taking credit for the
// user's life.
//
// No friction against recording twice in a day, and no encouragement either.
// Additions being rare is a fact about someone's life, not a rule this enforces.
//
// One brake exists and it is not a rule about frequency: the line is capped at
// what the wings can physically hold, asked of wing-text rather than picked. A
// kigo that its own butterfly could not show you must not be recordable, and
// the medium is the right place for that to live.
//
// --- the input is a real input -----------------------------------------------
//
// The typing goes through a hidden DOM `<input>` positioned over the slip, not
// through key handlers. That buys IME support, and it is not optional: this is
// a Japanese form, wing-text goes to the trouble of breaking Japanese, and an
// app that could render 夕餉のあいだ台所に携帯を置いておく but not let anyone type it would
// be a strange sort of almanac. The input is transparent and the words are
// drawn in ink on the canvas; it is positioned over the slip rather than parked
// off-screen so the IME's candidate window comes up where the writing is.

import {
  chrysalisKnobs,
  chrysalisSlot,
  chrysalisTilt,
  drawFoldedSquare,
  hideChrysalis,
} from "./chrysalis";
import { HOLES, cutHole, holeKnobs } from "./holes";
import { mulberry32 } from "./noise";
import { lightVector, strokeCutEdge, type Rect } from "./paper";
import {
  CATEGORIES,
  paletteFor,
  paperStock,
  rgba,
  type Category,
  type RGB,
  type Stock,
} from "./papers";
import {
  SCISSORS,
  drawScissors,
  resetScissors,
  scissorsAt,
  scissorsHit,
  scissorsKnobs,
  stepScissors,
} from "./scissors";
import type { Knob } from "./tuning-panel";
import { VISIT } from "./visit";
import { HANDWRITING, INK, wingTextBudget, wrapLines } from "./wing-text";

// The one ink in the app, as a plain triple.
const ink: RGB = [INK[0], INK[1], INK[2]];

export const RECORD = {
  // The slip. Its height is always half its width and is not a knob: three
  // folds of a 2:1 rectangle — left over right, top over bottom, left over
  // right — land on an exact square, and any other proportion lands on an
  // oblong that has to be fudged into one.
  slipW: 0.54, // of the sheet's width
  slipY: 0.28, // its centre, as a fraction of the sheet's height

  arriveSec: 0.5,
  leaveSec: 0.3,
  dyeSec: 0.22, // how long the paper takes to take a colour

  padding: 0.08, // of the slip's width: the margin the writing keeps
  font: 0.16, // of the slip's height
  line: 1.34,
  caretSec: 1.6, // one breath of the caret, in seconds

  swatchY: 0.61,
  swatchSize: 0.044, // of the sheet's width
  swatchGap: 0.018,
  swatchLift: 2.4,
  nameY: 0.695,
  nameFont: 0.036, // of the sheet's width

  foldSec: 1.15,
  settleSec: 0.85,

  shadowBlur: 13,
  shadowDrop: 7,
  shadowAlpha: 0.46,

  // A blank slip is a piece of the back sheet, because that is exactly what it
  // is. It takes a dye only when a paper is chosen.
  blank: "#efe7d6",
};

/**
 * Where the ceremony has got to.
 *
 * `sealing` is the only one that waits on something outside this module: the
 * store write. It is a phase of its own rather than an `await` inside the
 * confirm handler because a disk that is slow, full or read-only must leave the
 * slip on screen with the words still in it, and not half a ceremony.
 */
export type RecordPhase =
  | "idle"
  | "writing"
  | "closing"
  | "sealing"
  | "cutting"
  | "folding"
  | "settling";

export interface RecordDraft {
  text: string;
  category: Category;
  created: string;
}

export interface RecordedKigo {
  id: string;
  category: Category;
  created: string;
  text: string;
}

export interface RecordOptions {
  /**
   * Mint an id and write the entry, atomically. The store layer, injected so
   * this module can be exercised against a Map instead of someone's diary.
   */
  create(draft: RecordDraft): Promise<{ id: string }>;
  /** The app's notion of today. Never the machine's own — see clock.ts. */
  today(): string;
  /** It is on disk. The saijiki is now one entry longer than it was. */
  onCreated(kigo: RecordedKigo): void;
}

let options: RecordOptions | null = null;

export function initRecord(next: RecordOptions): void {
  options = next;
}

// --- state -------------------------------------------------------------------

let phase: RecordPhase = "idle";
let u = 0; // how far the slip has come forward, 0 at the scissors and 1 in place
let line = "";
let chosen: Category | null = null;
let hovered: Category | null = null;
let pending: string | null = null; // the id whose square is still in the air
let elapsed = 0; // seconds into the current phase
let breath = 0; // the caret's own clock, in seconds

// The paper takes a colour rather than changing to one.
let dyeFrom: Stock = paperStock(RECORD.blank);
let dyeTo: Stock = dyeFrom;
let dyeU = 1;

export function recordPhase(): RecordPhase {
  return phase;
}

/**
 * Is the slip open and taking words?
 *
 * Narrower than "the ceremony is running": once the cut starts there is nothing
 * left to type at, and nothing to cancel either.
 */
export function isRecording(): boolean {
  return phase === "writing" || phase === "closing" || phase === "sealing";
}

/** The id whose folded square this module is still carrying, if any. */
export function recordPendingId(): string | null {
  return pending;
}

/** What has been typed so far. */
export function recordLine(): string {
  return line;
}

// The cap, in characters.
//
// Derived even before there is a canvas to measure with, because a number
// picked here could drift away from what the wings actually hold and nobody
// would find out. An ideograph is one em wide by definition, which is exactly
// the conservative assumption `wingTextBudget` is built on — so measuring
// against a nominal em gives the right answer without a font. `measureBudget`
// refines it once the machine's own hand is known.
let budget = wingTextBudget(VISIT.span, (fontPx, text) => [...text].length * fontPx);

/** How many characters the wings will hold. The cap, and it comes from them. */
export function lineBudget(): number {
  return budget;
}

/**
 * Recompute the cap.
 *
 * Needs a canvas to measure the installed hand, so it is done once the app has
 * one rather than at import. The default above is a safe understatement for the
 * shipped span; it is only ever in force if this is never called.
 */
export function measureBudget(ctx: CanvasRenderingContext2D): void {
  budget = wingTextBudget(VISIT.span, (fontPx, text) => {
    ctx.save();
    ctx.font = `${fontPx}px ${HANDWRITING}`;
    const w = ctx.measureText(text).width;
    ctx.restore();
    return w;
  });
  writeLine(line);
}

// --- opening and closing -----------------------------------------------------

export function openSlip(): void {
  if (phase !== "idle" && phase !== "closing") return;
  phase = "writing";
  elapsed = 0;
  line = "";
  chosen = null;
  hovered = null;
  dyeFrom = paperStock(RECORD.blank);
  dyeTo = dyeFrom;
  dyeU = 1;
  openField();
}

/**
 * Escape, and it leaves no trace at all.
 *
 * No file, no hole, no id spent. That is why the id is minted on confirm and
 * not when the slip appears: an id is the one thing in this app that can never
 * be taken back, since a butterfly's whole appearance derives from it, and
 * spending one on a slip somebody thought better of would quietly burn a
 * creature that nobody ever saw.
 */
export function cancelSlip(): void {
  // Only while there is still a decision to take back. Once Enter has been
  // pressed the entry is on its way to disk, and an Escape that raced the write
  // could only ever produce one of two wrong answers: a file with no butterfly,
  // or a butterfly with no file.
  if (phase !== "writing") return;
  phase = "closing";
  closeField();
}

/**
 * Enter. From here the ceremony runs on its own and cannot be stopped, which is
 * correct: the entry is already true, and the rest is only how it looks.
 */
export function confirmSlip(): void {
  if (phase !== "writing") return;
  const text = line.trim();
  if (!text) return; // nothing written yet. Escape is how you leave, not this
  const io = options;
  if (!io) return;

  const category = chosen ?? "muki";
  const created = io.today();
  phase = "sealing";
  elapsed = 0;
  closeField();
  // Undyed paper filed under no season: the slip and the stock agree, so a
  // blank one takes the flax colour over the cut rather than jumping to it.
  dye(paletteFor(category));

  io.create({ text, category, created }).then(
    ({ id }) => {
      // Reported before anything else and whatever the phase has become. The
      // entry is on disk; the ceremony is only how that looked. If the view was
      // torn down mid-write — a mode change, a resize — the animation is lost
      // and the kigo is not, which is the only way round that is survivable.
      io.onCreated({ id, category, created, text });
      if (phase !== "sealing") return;
      pending = id;
      hideChrysalis(id);
      cutHole(id);
      phase = "cutting";
      elapsed = 0;
    },
    (error) => {
      // Never fatal, and never a warning on the sheet: CLAUDE.md forbids badges
      // and alerts outright. The words stay where they were and the slip is
      // still open, which is the only honest thing a disk failure can look like.
      console.error("[store] could not write the kigo; the slip is still open.", error);
      if (phase !== "sealing") return;
      phase = "writing";
      elapsed = 0;
      openField();
    },
  );
}

/** Tests, and mode changes: put everything back without a ceremony. */
export function resetRecord(): void {
  phase = "idle";
  u = 0;
  line = "";
  chosen = null;
  hovered = null;
  pending = null;
  elapsed = 0;
  hideChrysalis(null);
  closeField();
  resetScissors();
}

// --- the pointer -------------------------------------------------------------

/**
 * Does the recording own this point for the purposes of *attention*?
 *
 * Registered with visit.ts. The scissors always claim their own footprint, and
 * while the slip is open the whole sheet is claimed — a butterfly flying up to
 * the cursor in the middle of writing a line would be the app interrupting the
 * one moment it exists for.
 */
export function recordClaimsPointer(x: number, y: number, sheet: Rect): boolean {
  if (phase !== "idle") return true;
  return scissorsHit(x, y, sheet);
}

/**
 * Does it own this point for the purposes of a *press*?
 *
 * Registered with input.ts, and deliberately narrower than the claim above: the
 * scissors, the slip and the swatches, and nothing else. Bare paper still drags
 * the window, so the widget can be moved out from in front of something even
 * with a slip open on it.
 */
export function recordClaimsPress(x: number, y: number, sheet: Rect): boolean {
  if (scissorsHit(x, y, sheet)) return true;
  if (!isRecording()) return false;
  if (inside(slipRect(sheet), x, y)) return true;
  return swatchAt(x, y, sheet) !== null;
}

/** A click. Returns true if it was ours, so the swarm never also sees it. */
export function recordClick(x: number, y: number, sheet: Rect): boolean {
  if (phase === "idle") {
    if (!scissorsHit(x, y, sheet)) return false;
    openSlip();
    return true;
  }
  if (isRecording()) {
    const swatch = swatchAt(x, y, sheet);
    if (swatch) choose(swatch);
    focusField(); // a click anywhere took focus off the input; take it back
    return true;
  }
  return true; // mid-ceremony: nothing is clickable, and nothing falls through
}

export function recordHover(x: number, y: number, sheet: Rect): void {
  hovered = isRecording() ? swatchAt(x, y, sheet) : null;
}

/** Arrow keys on the input, so a paper can be picked without reaching for a mouse. */
export function cyclePaper(step: number): void {
  if (!isRecording()) return;
  const at = chosen === null ? -1 : CATEGORIES.indexOf(chosen);
  const n = CATEGORIES.length;
  choose(CATEGORIES[(((at + step) % n) + n) % n]);
}

function choose(category: Category): void {
  if (chosen === category) return;
  chosen = category;
  dye(paletteFor(category));
}

function dye(to: Stock): void {
  dyeFrom = stockNow();
  dyeTo = to;
  dyeU = 0;
}

// --- the frame ---------------------------------------------------------------

export function stepRecord(dt: number, cursor: { x: number; y: number } | null, sheet: Rect): void {
  stepScissors(dt, phase === "idle" ? cursor : null, sheet);
  if (dt > 0) {
    elapsed += dt;
    breath += dt;
    dyeU = Math.min(1, dyeU + dt / Math.max(0.01, RECORD.dyeSec));
  }

  switch (phase) {
    case "writing":
    case "sealing":
      u += (1 - u) * easeK(dt, RECORD.arriveSec);
      placeField(sheet);
      break;
    case "closing":
      u += (0 - u) * easeK(dt, RECORD.leaveSec);
      if (u < 0.02) {
        u = 0;
        phase = "idle";
        line = "";
      }
      break;
    case "cutting":
      // The sheet is being cut behind the slip. holes.ts owns how long that
      // takes, because it owns what it looks like.
      if (elapsed >= HOLES.cutSec) {
        phase = "folding";
        elapsed = 0;
      }
      break;
    case "folding":
      if (elapsed >= RECORD.foldSec) {
        phase = "settling";
        elapsed = 0;
      }
      break;
    case "settling":
      if (elapsed >= RECORD.settleSec) {
        phase = "idle";
        elapsed = 0;
        u = 0;
        line = "";
        chosen = null;
        pending = null;
        hideChrysalis(null); // the row draws it from here on
      }
      break;
    case "idle":
      break;
  }
}

/** The floor of the box: the scissors, which everything else flies in front of. */
export function drawRecordFloor(ctx: CanvasRenderingContext2D, sheet: Rect): void {
  drawScissors(ctx, sheet);
}

/** The front of the box: the slip, the swatches, and the square on its way down. */
export function drawRecordFront(ctx: CanvasRenderingContext2D, sheet: Rect): void {
  switch (phase) {
    case "idle":
      return;
    case "writing":
    case "closing":
    case "sealing":
      drawSlip(ctx, sheet);
      drawSwatches(ctx, sheet);
      return;
    case "cutting":
      drawSlip(ctx, sheet);
      return;
    case "folding":
      drawFolding(ctx, sheet);
      return;
    case "settling":
      drawSettling(ctx, sheet);
      return;
  }
}

// --- where everything is -----------------------------------------------------

function slipSize(sheet: Rect): { w: number; h: number } {
  const w = Math.max(40, sheet.w * RECORD.slipW);
  return { w, h: w / 2 };
}

/** The slip in place, at the front of the box. */
function slipRect(sheet: Rect): Rect {
  const { w, h } = slipSize(sheet);
  return {
    x: sheet.x + (sheet.w - w) / 2,
    y: sheet.y + sheet.h * RECORD.slipY - h / 2,
    w,
    h,
    r: 0,
  };
}

// Where it is right now: still folded up in the scissors at u = 0, in place at
// u = 1. It comes *out* of the scissors because that is where it was cut from,
// and a slip that faded in at the front of the box would have come from nowhere.
function slipNow(sheet: Rect): Rect {
  const to = slipRect(sheet);
  if (u >= 1) return to;
  const from = scissorsAt(sheet);
  const k = u * u * (3 - 2 * u); // a little easing on the shape as well as the timing
  const w = to.w * k;
  const h = to.h * k;
  return {
    x: from.x + (to.x + to.w / 2 - from.x) * k - w / 2,
    y: from.y + (to.y + to.h / 2 - from.y) * k - h / 2,
    w,
    h,
    r: 0,
  };
}

interface Swatch {
  category: Category;
  x: number;
  y: number;
  size: number;
}

function swatches(sheet: Rect): Swatch[] {
  const size = Math.max(6, sheet.w * RECORD.swatchSize);
  const step = size + sheet.w * RECORD.swatchGap;
  const total = CATEGORIES.length * size + (CATEGORIES.length - 1) * (step - size);
  const left = sheet.x + (sheet.w - total) / 2;
  const y = sheet.y + sheet.h * RECORD.swatchY;
  return CATEGORIES.map((category, i) => ({
    category,
    x: left + i * step + size / 2,
    y,
    size,
  }));
}

function swatchAt(x: number, y: number, sheet: Rect): Category | null {
  if (!isRecording()) return null;
  for (const s of swatches(sheet)) {
    const r = s.size / 2 + 3; // a little larger than the paper: these are 15px
    if (x >= s.x - r && x <= s.x + r && y >= s.y - r && y <= s.y + r) return s.category;
  }
  return null;
}

function inside(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

// --- drawing the slip --------------------------------------------------------

function stockNow(): Stock {
  if (dyeU >= 1) return dyeTo;
  const t = dyeU * dyeU * (3 - 2 * dyeU);
  const blend = (a: RGB, b: RGB): RGB => [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
  return {
    base: blend(dyeFrom.base, dyeTo.base),
    lit: blend(dyeFrom.lit, dyeTo.lit),
    dark: blend(dyeFrom.dark, dyeTo.dark),
    body: blend(dyeFrom.body, dyeTo.body),
  };
}

function rectPath(r: Rect): Path2D {
  const path = new Path2D();
  path.rect(r.x, r.y, r.w, r.h);
  return path;
}

/**
 * The slip is at the front of the box, and the shadow is the only thing that
 * says so — a blank one is a piece of the back sheet, the same cream on the same
 * cream, and without a shadow under it there is nothing to see at all.
 *
 * The caster is filled where it stands rather than being painted off-canvas and
 * fetched back by the shadow offset, which is the trick everything else in this
 * app uses. It cannot be used here: the fold runs inside a rotated context, and
 * canvas shadow offsets are *not* rotated with it, so a three-thousand pixel
 * excursion and a three-thousand pixel offset stop cancelling the moment the
 * paper tilts by a degree. The trick exists for casters with holes in them; a
 * slip is a solid rectangle and the paper drawn over it covers the caster
 * exactly.
 */
function dropShadow(ctx: CanvasRenderingContext2D, path: Path2D, rise: number): void {
  const L = lightVector();
  ctx.save();
  ctx.shadowColor = rgba([30, 22, 14], RECORD.shadowAlpha);
  ctx.shadowBlur = RECORD.shadowBlur * rise;
  ctx.shadowOffsetX = -L.x * RECORD.shadowDrop * rise;
  ctx.shadowOffsetY = -L.y * RECORD.shadowDrop * rise;
  ctx.fillStyle = rgba([40, 30, 18], 1);
  ctx.fill(path);
  ctx.restore();
}

// One face of the paper. `front` is the side that was written on; the back is
// the same stock a shade duller, because it is the same sheet turned over and
// the light no longer reaches it the same way.
function paperFace(ctx: CanvasRenderingContext2D, r: Rect, stock: Stock, front: boolean): void {
  const path = rectPath(r);
  ctx.fillStyle = rgba(front ? stock.base : stock.body, 1);
  ctx.fill(path);

  // the key light across the sheet, upper left to lower right
  const grad = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
  grad.addColorStop(0, "rgba(255,253,246,0.16)");
  grad.addColorStop(0.55, "rgba(255,255,255,0)");
  grad.addColorStop(1, "rgba(40,30,18,0.09)");
  ctx.fillStyle = grad;
  ctx.fill(path);

  // Pulp. The slip was cut out of the back sheet a second ago, so it has the
  // same fibre in it — and an undyed one has nothing else to say that it is
  // paper at all, being the sheet's own colour on the sheet's own colour. Off a
  // fixed seed, so it does not crawl from frame to frame.
  ctx.save();
  ctx.clip(path);
  const rng = mulberry32(0x5a1_11f);
  ctx.lineCap = "round";
  for (let i = 0; i < 34; i++) {
    const x = r.x + rng() * r.w;
    const y = r.y + rng() * r.h;
    const a = rng() * Math.PI * 2;
    const len = (2 + rng() * 5) * Math.min(1, r.h / 90);
    ctx.strokeStyle = rng() < 0.55 ? rgba(stock.lit, 0.2) : rgba(stock.dark, 0.14);
    ctx.lineWidth = 0.4 + rng() * 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.restore();

  strokeCutEdge(
    ctx,
    path,
    rgba(stock.lit, 0.8),
    rgba(stock.dark, 0.5),
    Math.max(0.5, r.h * 0.014),
    Math.max(0.4, r.h * 0.01),
  );
}

function drawSlip(ctx: CanvasRenderingContext2D, sheet: Rect): void {
  const r = slipNow(sheet);
  if (r.w < 2 || r.h < 2) return;
  const stock = stockNow();
  dropShadow(ctx, rectPath(r), 1);
  paperFace(ctx, r, stock, true);
  drawWriting(ctx, r, u);
}

/**
 * The line, in ink, on the slip.
 *
 * The same hand and the same breaking rules the wings use, because it is the
 * same writing: the words are put on the flat slip and the slip is then folded
 * into the creature, so what is read on an opened butterfly is literally this,
 * seen again later.
 */
function drawWriting(ctx: CanvasRenderingContext2D, r: Rect, alpha: number): void {
  const pad = r.w * RECORD.padding;
  const maxW = r.w - pad * 2;
  const fontPx = Math.max(7, r.h * RECORD.font);
  const lineHeight = fontPx * RECORD.line;
  ctx.save();
  ctx.font = `${fontPx}px ${HANDWRITING}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const lines = line ? wrapLines(line, maxW, (s) => ctx.measureText(s).width) : [];
  const top = r.y + r.h / 2 - ((Math.max(1, lines.length) - 1) * lineHeight) / 2;
  ctx.fillStyle = rgba(ink, Math.min(1, alpha));
  lines.forEach((text, i) => ctx.fillText(text, r.x + r.w / 2, top + i * lineHeight));

  // The nib, resting where the next character goes. It breathes rather than
  // blinks — a hard blink is a text cursor in a form, and this is a pen held
  // over paper.
  if (isRecording() && phase !== "sealing") {
    const last = lines[lines.length - 1] ?? "";
    const w = last ? ctx.measureText(last).width : 0;
    const cx = r.x + r.w / 2 + w / 2 + fontPx * 0.12;
    const cy = top + Math.max(0, lines.length - 1) * lineHeight;
    const pulse = 0.35 + 0.45 * (0.5 + 0.5 * Math.cos((breath / RECORD.caretSec) * Math.PI * 2));
    ctx.strokeStyle = rgba(ink, pulse * alpha);
    ctx.lineWidth = Math.max(0.8, fontPx * 0.06);
    ctx.beginPath();
    ctx.moveTo(cx, cy - fontPx * 0.42);
    ctx.lineTo(cx, cy + fontPx * 0.42);
    ctx.stroke();
  }
  ctx.restore();
}

// --- the swatches ------------------------------------------------------------
//
// Eight small pieces of the eight stocks, laid out in the saijiki's own order.
// No labels on them: nothing else in this diorama has a label, and eight
// coloured papers in a row is not a form. The name of whichever one is under
// the cursor is written underneath in the same hand as everything else — ink on
// paper rather than a tooltip, and it costs nothing when nobody is looking.

function drawSwatches(ctx: CanvasRenderingContext2D, sheet: Rect): void {
  const alpha = Math.min(1, u * 1.4);
  if (alpha <= 0.02) return;
  const L = lightVector();
  ctx.save();
  ctx.globalAlpha = alpha;

  for (const s of swatches(sheet)) {
    const picked = chosen === s.category;
    const lift = picked ? 1 : hovered === s.category ? 0.55 : 0;
    const stock = paletteFor(s.category);
    const half = s.size / 2;
    const r: Rect = {
      x: s.x - half + L.x * lift * RECORD.swatchLift,
      y: s.y - half + L.y * lift * RECORD.swatchLift,
      w: s.size,
      h: s.size,
      r: 0,
    };
    const path = rectPath(r);
    ctx.save();
    ctx.shadowColor = rgba([30, 22, 14], 0.34);
    ctx.shadowBlur = 1.6 + lift * 3;
    ctx.shadowOffsetX = -L.x * (1.2 + lift * 2.4) + 3000;
    ctx.shadowOffsetY = -L.y * (1.2 + lift * 2.4);
    ctx.translate(-3000, 0);
    ctx.fillStyle = "#000";
    ctx.fill(path);
    ctx.restore();

    ctx.fillStyle = rgba(stock.base);
    ctx.fill(path);
    strokeCutEdge(
      ctx,
      path,
      rgba(stock.lit, 0.9),
      rgba(stock.dark, 0.55),
      Math.max(0.5, s.size * 0.07),
      Math.max(0.4, s.size * 0.05),
    );
  }

  const named = hovered ?? chosen;
  if (named) {
    const fontPx = Math.max(8, sheet.w * RECORD.nameFont);
    ctx.font = `${fontPx}px ${HANDWRITING}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = rgba(ink, 0.55);
    ctx.fillText(named, sheet.x + sheet.w / 2, sheet.y + sheet.h * RECORD.nameY);
  }
  ctx.restore();
}

// --- the fold ----------------------------------------------------------------
//
// Three halvings: left over right, top over bottom, left over right. A flap
// swings about its crease, and the swing is a scale from +1 to -1 about that
// line — which is exactly what a rigid half-turn about a vertical axis looks
// like from straight on, and this is a paper diorama seen straight on.
//
// Past the halfway point the flap is showing its back, so it is drawn as the
// back: no writing, and the duller side of the stock. That is where the words
// go — inside the fold, and they are not seen again until a butterfly lands and
// opens, which is the whole arrangement CLAUDE.md describes.

export type Axis = "v" | "h";

/**
 * The three creases, in the order they are made.
 *
 * Exported because Emergence runs this list backwards and must not be running a
 * copy of it: a fold and an unfold that disagreed about the order would be a
 * square that opened into a different square, and the two would drift apart the
 * first time either was touched.
 */
export const FOLDS: readonly Axis[] = ["v", "h", "v"];

function stageOf(progress: number): { stage: number; p: number } {
  const scaled = Math.min(FOLDS.length, Math.max(0, progress) * FOLDS.length);
  const stage = Math.min(FOLDS.length - 1, Math.floor(scaled));
  return { stage, p: Math.min(1, scaled - stage) };
}

/** The rectangle left after `n` complete folds. Right half, then bottom, then right. */
export function afterFolds(slip: Rect, n: number): Rect {
  let r = slip;
  for (let i = 0; i < n; i++) {
    r =
      FOLDS[i] === "v"
        ? { x: r.x + r.w / 2, y: r.y, w: r.w / 2, h: r.h, r: 0 }
        : { x: r.x, y: r.y + r.h / 2, w: r.w, h: r.h / 2, r: 0 };
  }
  return r;
}

function drawFolding(ctx: CanvasRenderingContext2D, sheet: Rect): void {
  const slip = slipRect(sheet);
  const progress = Math.min(1, elapsed / Math.max(0.05, RECORD.foldSec));
  const { stage, p } = stageOf(progress);
  const stock = stockNow();

  const base = afterFolds(slip, stage);
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

  // Where the paper is right now, for the small twist it takes as it folds —
  // which is also what makes the hand-off to the settled square seamless, since
  // by the last frame the twist is exactly the one that square is drawn with.
  const spread = Math.abs(1 - 2 * p);
  const seen: Rect =
    axis === "v"
      ? { x: still.x - still.w * spread, y: still.y, w: still.w * (1 + spread), h: still.h, r: 0 }
      : { x: still.x, y: still.y - still.h * spread, w: still.w, h: still.h * (1 + spread), r: 0 };

  ctx.save();
  ctx.translate(seen.x + seen.w / 2, seen.y + seen.h / 2);
  ctx.rotate(chrysalisTilt(pending ?? "") * progress);
  ctx.translate(-(seen.x + seen.w / 2), -(seen.y + seen.h / 2));

  dropShadow(ctx, rectPath(still), 1 + (1 - progress) * 0.4);

  // the half that is staying put, with whatever writing is still on show
  ctx.save();
  ctx.beginPath();
  ctx.rect(still.x, still.y, still.w, still.h);
  ctx.clip();
  paperFace(ctx, base, stock, stage === 0);
  if (stage === 0) drawWriting(ctx, slip, 1);
  ctx.restore();

  // the flap's shadow, thrown across the half it is closing onto
  const shade = Math.sin(Math.PI * p);
  if (shade > 0.01) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(still.x, still.y, still.w, still.h);
    ctx.clip();
    const grad =
      axis === "v"
        ? ctx.createLinearGradient(crease, 0, crease + still.w * 0.8, 0)
        : ctx.createLinearGradient(0, crease, 0, crease + still.h * 0.8);
    grad.addColorStop(0, rgba(stock.dark, 0.42 * shade));
    grad.addColorStop(1, rgba(stock.dark, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(still.x, still.y, still.w, still.h);
    ctx.restore();
  }

  // the flap itself, swinging over
  const turned = p > 0.5;
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
    ctx.beginPath();
    ctx.rect(flap.x, flap.y, flap.w, flap.h);
    ctx.clip();
    paperFace(ctx, base, stock, !turned && stage === 0);
    if (!turned && stage === 0) drawWriting(ctx, slip, 1);
    // edge-on, the paper takes almost no light at all
    ctx.fillStyle = rgba([26, 19, 12], 0.5 * shade);
    ctx.fillRect(flap.x - 4, flap.y - 4, flap.w + 8, flap.h + 8);
    ctx.restore();
  }
  ctx.restore();
}

// --- the settling ------------------------------------------------------------

function drawSettling(ctx: CanvasRenderingContext2D, sheet: Rect): void {
  if (!pending) return;
  const from = afterFolds(slipRect(sheet), FOLDS.length);
  const slot = chrysalisSlot(pending, sheet);
  const t = Math.min(1, elapsed / Math.max(0.05, RECORD.settleSec));
  const k = t * t * (3 - 2 * t);
  const stock = stockNow();

  const toX = slot ? slot.x : from.x + from.w / 2;
  const toY = slot ? slot.y : sheet.y + sheet.h * 0.9;
  const toSize = slot ? slot.size : from.w * 0.4;

  drawFoldedSquare(
    ctx,
    pending,
    stock,
    from.x + from.w / 2 + (toX - (from.x + from.w / 2)) * k,
    from.y + from.h / 2 + (toY - (from.y + from.h / 2)) * k,
    from.w + (toSize - from.w) * k,
    1 - k,
  );
}

// --- the hidden input --------------------------------------------------------

let field: HTMLInputElement | null = null;
let composing = false;

function hasDom(): boolean {
  return typeof document !== "undefined";
}

function makeField(): HTMLInputElement {
  const el = document.createElement("input");
  el.type = "text";
  el.className = "slip-input";
  el.autocomplete = "off";
  el.spellcheck = false;
  // `inputMode` and the lack of a maxLength are both deliberate: an IME needs
  // to be able to overrun briefly while composing, and the cap is applied on
  // the way out instead. See `writeLine`.
  el.addEventListener("compositionstart", () => {
    composing = true;
  });
  el.addEventListener("compositionend", () => {
    composing = false;
    writeLine(el.value);
  });
  el.addEventListener("input", () => writeLine(el.value));
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (!composing) confirmSlip();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelSlip();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // Vertical arrows do nothing useful in a one-line field, so they are the
      // one pair that can be borrowed without fighting the caret.
      e.preventDefault();
      e.stopPropagation();
      cyclePaper(e.key === "ArrowDown" ? 1 : -1);
    } else {
      e.stopPropagation(); // dev keys are not shortcuts while someone is writing
    }
  });
  document.body.appendChild(el);
  return el;
}

/**
 * What the field says, cleaned up and capped.
 *
 * One line means one line: an `<input>` cannot hold a newline, but a paste can
 * carry tabs and separators through, so they are flattened to spaces here.
 *
 * The cap is applied by code point rather than by `maxLength`, which counts
 * UTF-16 units and would cut a budget in half for anyone writing in a script
 * that lives outside the basic plane. It is not applied at all while an IME is
 * composing: clipping a half-written 変換 out from under the candidate window is
 * the fastest way to make a Japanese keyboard unusable.
 */
export function writeLine(text: string): void {
  const flat = text.replace(/[\r\n\t\v\f\u2028\u2029]+/gu, " ");
  const capped = composing ? flat : [...flat].slice(0, budget).join("");
  line = capped;
  if (field && field.value !== capped) field.value = capped;
}

function openField(): void {
  if (!hasDom()) return;
  field ??= makeField();
  field.value = line;
  field.style.display = "block";
  focusField();
}

function focusField(): void {
  if (isRecording()) field?.focus({ preventScroll: true });
}

function closeField(): void {
  composing = false;
  if (!field) return;
  field.blur();
  field.style.display = "none";
}

// Over the slip, at roughly the size the writing is drawn at. Invisible, but
// really there and really that size — an IME puts its candidate window at the
// caret, and a field parked off-screen would put the候補 list in the corner of
// the desktop instead of under the words.
function placeField(sheet: Rect): void {
  if (!field) return;
  const r = slipNow(sheet);
  const pad = r.w * RECORD.padding;
  const fontPx = Math.max(7, r.h * RECORD.font);
  field.style.left = `${Math.round(r.x + pad)}px`;
  field.style.top = `${Math.round(r.y + r.h / 2 - fontPx)}px`;
  field.style.width = `${Math.round(Math.max(8, r.w - pad * 2))}px`;
  field.style.height = `${Math.round(fontPx * 2)}px`;
  field.style.fontSize = `${Math.round(fontPx)}px`;
}

// --- the overlay and the panel -----------------------------------------------

/** One line for F9. Says the phase and how much of the cap is spent, never the words. */
export function recordStatus(): string {
  if (phase === "idle") return "slip: —";
  const kept = [...line].length;
  return `slip: ${phase} · ${kept}/${budget} · ${chosen ?? "undyed"}`;
}

export function recordKnobs(): Knob[] {
  const R = RECORD as unknown as Record<string, number>;
  const knob = (key: string, min: number, max: number, step: number): Knob => ({
    group: "slip",
    label: key,
    min,
    max,
    step,
    get: () => R[key],
    set: (v) => {
      R[key] = v;
    },
  });

  return [
    knob("slipW", 0.2, 0.9, 0.005),
    knob("slipY", 0, 1, 0.005),
    knob("arriveSec", 0.05, 2, 0.01),
    knob("leaveSec", 0.05, 2, 0.01),
    knob("dyeSec", 0.02, 1, 0.01),
    knob("padding", 0, 0.3, 0.005),
    knob("font", 0.05, 0.4, 0.005),
    knob("line", 0.9, 2.2, 0.02),
    knob("caretSec", 0.4, 4, 0.05),
    knob("swatchY", 0, 1, 0.005),
    knob("swatchSize", 0.01, 0.12, 0.002),
    knob("swatchGap", 0, 0.08, 0.002),
    knob("swatchLift", 0, 10, 0.1),
    knob("nameY", 0, 1, 0.005),
    knob("nameFont", 0.015, 0.09, 0.002),
    knob("foldSec", 0.2, 4, 0.05),
    knob("settleSec", 0.1, 3, 0.05),
    knob("shadowBlur", 0, 30, 0.5),
    knob("shadowDrop", 0, 20, 0.5),
    knob("shadowAlpha", 0, 1, 0.01),
    ...scissorsKnobs(),
    ...holeKnobs(),
    ...chrysalisKnobs(),
  ];
}

/** The ceremony's constants, in blocks that paste back over the objects. */
export function recordConfigJson(): string {
  return (
    `// src/record.ts — replaces RECORD\n${JSON.stringify(RECORD, null, 2)}\n\n` +
    `// src/scissors.ts — replaces SCISSORS\n${JSON.stringify(SCISSORS, null, 2)}\n\n` +
    `// src/holes.ts — replaces HOLES\n${JSON.stringify(HOLES, null, 2)}\n`
  );
}

function easeK(dt: number, sec: number): number {
  return dt <= 0 ? 0 : 1 - Math.exp(-dt / Math.max(0.01, sec));
}
