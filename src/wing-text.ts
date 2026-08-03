// The line, written on the inside of the wings.
//
// CLAUDE.md: "Text lives on the inner surface of the wings — invisible in
// flight, readable only when a butterfly lands and opens." That is the whole
// reason a butterfly has to physically come to the cursor and unfold: there is
// nowhere else the words exist. No panel, no card, no tooltip.
//
// It is written *across* the creature rather than on one wing, because that is
// where it was written: the recording ceremony cuts a slip out of the back
// sheet, the line is written on the flat slip, and the slip is then folded into
// the creature. The mountain fold runs through the writing, exactly as it does
// on any folded note, and the punched cuts take bites out of it. Neither is a
// defect to be worked around.
//
// The face is a system handwriting stack. Nothing is bundled: this repository is
// public and a font licence is not a decision to make in passing. The stack is
// one constant so that swapping it for a real, licensed face later is one line.

/**
 * A hand, if the machine has one; a book face if it does not.
 *
 * Segoe Script and Ink Free ship with Windows, Bradley Hand and Chalkboard SE
 * with macOS. Most Linux boxes have none of them and land on the serif tail,
 * which is why the tail is a reading serif rather than `cursive` — a generic
 * `cursive` there resolves to whatever the fontconfig default happens to be,
 * and it is usually the same sans as everything else.
 */
export const HANDWRITING =
  '"Segoe Script", "Ink Free", "Bradley Hand", "Chalkboard SE", "Segoe Print", ' +
  '"Iowan Old Style", "Hoefler Text", Palatino, Georgia, serif';

/** Warm sumi rather than black. Nothing in this app is pure anything. */
export const INK: readonly [number, number, number] = [54, 41, 31];

// Tuned by eye against a landed butterfly, which is the only place it appears.
//
// `width` and `height` are fractions of the wingspan and describe the patch of
// wing the words are allowed onto. It is a good deal smaller than the creature,
// because the creature is not a rectangle: the forewings are broad and the
// hindwings taper to a tail, so a block sized to the full span would run off
// the paper on its lowest line and only on its lowest line — which reads as a
// mistake rather than as a style.
//
// `rise` is the other half of that. The writing sits above the middle of the
// fold rather than on it, in the forewings, which are the widest and flattest
// paper the creature has.
// `height` is also what sets the cap on a new entry, which is why it is 0.42
// and not the 0.38 it was tuned to by eye. At the reading span, the difference
// is one more line of the smallest hand — five instead of four — and that line
// is what takes `wingTextBudget` past forty-one characters. Forty-one is
// CLAUDE.md's own example entry, and a medium that could not hold the line the
// app was designed around would be enforcing the wrong brevity.
export const WING_TEXT = {
  width: 0.62, // of the wingspan
  height: 0.42,
  rise: 0.06, // how far above the origin the block is centred
  font: 0.084, // of the wingspan, before it is shrunk to fit
  fontMin: 0.055,
  floorPx: 11, // and never smaller than this, whatever the wingspan says
  line: 1.34, // line height, in ems
};

export interface WingTextLayout {
  fontPx: number;
  lineHeight: number;
  /** css px above the creature's origin that the block is centred. */
  rise: number;
  lines: string[];
}

/** How wide `text` is at `fontPx`. Supplied by the caller so this stays pure. */
export type Measure = (fontPx: number, text: string) => number;

export function fontOf(fontPx: number): string {
  return `${fontPx}px ${HANDWRITING}`;
}

/**
 * Break `text` to fit `maxWidth`.
 *
 * Words first, then characters for anything that will not fit on a line of its
 * own — which is not an edge case but the ordinary path for Japanese, where
 * there are no spaces to break at and a whole entry is one "word".
 */
export function wrapLines(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string[] {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  // `word` starts a fresh line, cut through if it will not fit even alone
  const start = (word: string) => {
    if (measure(word) <= maxWidth) {
      line = word;
      return;
    }
    const pieces = breakWord(word, maxWidth, measure);
    line = pieces.pop() ?? "";
    lines.push(...pieces);
  };

  for (const word of words) {
    if (!line) {
      start(word);
      continue;
    }
    const joined = `${line} ${word}`;
    if (measure(joined) <= maxWidth) {
      line = joined;
      continue;
    }
    lines.push(line);
    start(word);
  }
  if (line) lines.push(line);
  return lines;
}

// By code point, so a surrogate pair is never split down the middle.
function breakWord(word: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  let piece = "";
  for (const ch of word) {
    const next = piece + ch;
    if (piece && measure(next) > maxWidth) {
      out.push(piece);
      piece = ch;
    } else {
      piece = next;
    }
  }
  out.push(piece);
  return out;
}

/**
 * Fit the line onto a wingspan of `span` css px.
 *
 * The font shrinks until the block fits the patch of wing it is allowed, and
 * then stops: below `floorPx` there is no point drawing it at all, so a very
 * long entry on a small creature overflows its box rather than becoming a grey
 * smudge. Entries are one line — this is a backstop, not the common case.
 *
 * Sizes are quantised to the half pixel so that the layout, which is cached
 * against the span, does not jitter as the creature grows.
 */
export function layoutWingText(text: string, span: number, measure: Measure): WingTextLayout {
  const W = WING_TEXT;
  const maxW = span * W.width;
  const maxH = span * W.height;
  const floor = Math.max(W.floorPx, span * W.fontMin);

  let fontPx = Math.max(floor, half(span * W.font));
  let lines: string[] = [];
  for (;;) {
    lines = wrapLines(text, maxW, (s) => measure(fontPx, s));
    const height = lines.length * fontPx * W.line;
    if (height <= maxH || fontPx <= floor) break;
    fontPx = Math.max(floor, half(fontPx - 0.5));
  }
  return { fontPx, lineHeight: fontPx * W.line, rise: span * W.rise, lines };
}

// The widest glyphs a line is likely to be made of. A CJK ideograph is a full
// em; a capital W is the widest letter most hands draw. The budget below is
// measured against whichever of these the installed face makes largest, so it
// is a promise about *any* string of that length rather than about an average
// one — a cap that fitted the average would let a line of capitals overrun.
const WIDEST = ["漢", "ぬ", "W", "M"];

/**
 * How many characters these wings can hold, at the smallest hand still worth
 * calling ink.
 *
 * This is what the recording slip caps its input at, and asking here rather
 * than picking a number is the point: the medium enforces the brevity. A kigo
 * that its own butterfly could not show you must not be recordable, and the only
 * thing that knows how much a butterfly can show is this module.
 *
 * Deliberately conservative, and the conservatism is load-bearing rather than
 * timid. It assumes the worst case on both axes — every line packed solid,
 * every character as wide as a full-em ideograph, the font already shrunk to
 * the floor. Latin letters are about half that, so a line of prose at the cap
 * uses roughly half the width the cap was measured against, and *that* is the
 * margin word wrapping is paid out of: breaking at spaces strands a few
 * characters at the end of every line, and a budget with no slack in it would
 * promise a fit it could not keep.
 */
export function wingTextBudget(span: number, measure: Measure): number {
  const W = WING_TEXT;
  const floor = Math.max(W.floorPx, span * W.fontMin);
  const lines = Math.max(1, Math.floor((span * W.height) / (floor * W.line)));
  const widest = Math.max(...WIDEST.map((ch) => measure(floor, ch)));
  const perLine = Math.max(1, Math.floor((span * W.width) / Math.max(0.001, widest)));
  return lines * perLine;
}

/**
 * Draw the block on a creature whose origin is (x, y).
 *
 * Straight ink on the paper: no card behind it, no halo, no shadow. Where a
 * punched cut passes under a letter the sheet shows through it, which is what
 * writing on papel picado does and is worth more than legibility bought with a
 * panel — the constitution is explicit that the butterfly opening is the entire
 * interface.
 *
 * `growth` is how large the creature is right now against the span the layout
 * was fitted to. The layout is deliberately fitted once, at the size it will
 * end at, and then merely scaled: the words are *written on the paper*, so as
 * the paper comes nearer they get bigger, and they do not re-break. Laying out
 * afresh at each size would reflow the line under the reader as it arrived,
 * which is the one thing writing on a physical object never does.
 */
export function drawWingText(
  ctx: CanvasRenderingContext2D,
  layout: WingTextLayout,
  x: number,
  y: number,
  alpha: number,
  growth = 1,
): void {
  if (alpha <= 0.004 || layout.lines.length === 0) return;
  const fontPx = layout.fontPx * growth;
  const lineHeight = layout.lineHeight * growth;
  ctx.save();
  ctx.font = fontOf(fontPx);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = `rgba(${INK[0]},${INK[1]},${INK[2]},${Math.min(1, alpha)})`;
  const middle = y - layout.rise * growth;
  const top = middle - ((layout.lines.length - 1) * lineHeight) / 2;
  layout.lines.forEach((line, i) => ctx.fillText(line, x, top + i * lineHeight));
  ctx.restore();
}

function half(v: number): number {
  return Math.round(v * 2) / 2;
}
