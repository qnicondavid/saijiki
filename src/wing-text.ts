// The writing on the inside of the wings: the season word, and the verses that
// gather under it.
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
//
// --- and the palimpsest -----------------------------------------------------
//
// A kigo in a real saijiki is a season word with example poems gathering
// underneath it, and that is the shape this borrowed. So a wing holds one line
// on the day it is written and, over years, a stanza — and a wing is small.
//
// Nothing paginates, scrolls or is cut off, because all three of those are ways
// of saying *there is more than you are being shown*, and this is a record of
// what somebody found to be true. So the writing genuinely fills the wing
// instead: the verse hand shrinks toward the same floor the season word has,
// the block tightens, and past the point where tightening runs out the older
// lines recede — packed closer and closer together and fainter and fainter, the
// way old ink goes on a page that has been written on for years.
//
// The recession is what makes it bounded. Spacing and ink come off one ratio,
// so ink laid into a vanishing space is proportionally fainter, and the total
// ink on the wing therefore converges however many verses arrive. A wing with
// forty verses is a legible recent stanza over a grey wash of everything
// before it, and it can never become a smudge — which is what would actually
// take the older writing away.
//
// The season word stays the largest and darkest thing on the wing. It is the
// kigo; the verses are underneath it, in a smaller and lighter hand, and the
// oldest of them pass behind it as ghosts.
//
// No dates, anywhere. How old a verse is, is said by how faint its ink has
// gone — and a date would be a number in an app that has spent its whole design
// avoiding them.

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
// `span` is the wingspan a butterfly lands and opens at, and it lives here
// rather than with the rest of the visit because it is a *reading* size: it is
// large because the words have to be legible at 100% zoom without leaning in,
// and it is what `wingTextBudget` measures the cap against. The visit consumes
// it — coming to the cursor is coming forward to that span — but it does not
// choose it.
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
//
// The `verse*` half is the palimpsest, and it is tuned against a wing carrying
// none, three and thirty — the last of which is a decade of use and is what
// /dev/wing.html exists to show. `verseFade` is the one to reach for first: it
// is how much slower the ink recedes than the spacing does, so 1 makes an old
// verse exactly as faint as it is cramped and anything below 1 lets it linger
// as a readable ghost for longer than it has room to be one.
export const WING_TEXT = {
  span: 190, // the wingspan a butterfly lands and opens at, in css px
  width: 0.62, // of the wingspan
  height: 0.42,
  rise: 0.06, // how far above the origin the block is centred
  font: 0.084, // of the wingspan, before it is shrunk to fit
  fontMin: 0.055,
  floorPx: 11, // and never smaller than this, whatever the wingspan says
  line: 1.34, // line height, in ems

  verse: 0.76, // the verse hand, as a fraction of the season word's
  verseFloorPx: 8, // and its own floor, below the season word's. See `layoutWings`
  // Narrower than the season word, and not for typographic reasons: the verses
  // are the bottom of the block, and the bottom of the block is where the
  // forewings end and the paper starts to give out. A line the season word's
  // width, written that low, has its ends over the notch between the wings.
  verseWidth: 0.52,
  verseLine: 1.18, // its line height, in ems: tighter than the season word's
  verseGap: 0.35, // the space under the season word, in verse line heights
  verseInk: 0.86, // how dark a verse is while it still has room to breathe
  verseFade: 0.45, // how much slower the ink recedes than the spacing does
  verseTight: 0.42, // the tightest the recession may ever pack, per line
};

export interface WingTextLayout {
  fontPx: number;
  lineHeight: number;
  /** css px above the creature's origin that the block is centred. */
  rise: number;
  lines: string[];
}

/** One line of the block, placed and inked. */
export interface WingLine {
  text: string;
  /** css px below the centre of the whole block. */
  y: number;
  fontPx: number;
  /** How much ink is left in it: 1 for the season word, less as a verse recedes. */
  ink: number;
}

/** Everything written on one pair of wings, laid out and ready to draw. */
export interface WingWriting {
  /** css px above the creature's origin that the block is centred. */
  rise: number;
  lines: WingLine[];
  /**
   * Where the nib is resting, while a verse is being written. Null the rest of
   * the time, which is nearly always.
   */
  nib: { x: number; y: number; fontPx: number } | null;
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

/**
 * The whole block: the season word, every verse under it, and the one being
 * written if there is one.
 *
 * `writing` is the verse currently being typed, and null the rest of the time.
 * It is laid out as the newest verse rather than as a special case, so the
 * block re-settles under the hand as the words arrive — which is the only
 * honest way to show someone how much room they have left.
 *
 * With nothing written under it this is one line centred on the fold, which is
 * the picture a wing has always shown and is written out separately below so
 * that it can never drift as the rest of this changes.
 */
export function layoutWings(
  text: string,
  verses: readonly string[],
  writing: string | null,
  span: number,
  measure: Measure,
): WingWriting {
  const W = WING_TEXT;
  const rise = span * W.rise;
  const head = layoutWingText(text, span, measure);
  const gathered = writing === null ? verses : [...verses, writing];
  const lines: WingLine[] = [];

  if (gathered.length === 0) {
    const lead = head.lineHeight;
    const top = lead / 2 - (head.lines.length * lead) / 2;
    head.lines.forEach((line, i) =>
      lines.push({ text: line, y: top + i * lead, fontPx: head.fontPx, ink: 1 }),
    );
    return { rise, lines, nib: null };
  }

  const maxW = span * W.width;
  const maxH = span * W.height;
  const floor = Math.max(W.floorPx, span * W.fontMin);

  // --- both hands shrink, together
  //
  // The season word alone very nearly fills this patch — CLAUDE.md's own example
  // entry takes four lines of it at the reading span, which is exactly what
  // `height` was sized against. So the arrival of a verse is precisely the
  // moment it has to give some of that back, and it does it the way a page does:
  // the heading is written large while it is alone on the paper and smaller once
  // a stanza has gathered under it.
  //
  // It stays the most prominent thing on the wing throughout, and it stays so on
  // all three counts — the largest hand, the fullest ink, and the top of the
  // block. What it does not get is the whole page.
  //
  // The two hands move together at a fixed ratio, so that relationship never
  // inverts, and they stop at two different floors: the season word at the
  // ordinary one, because the entry itself must always be readable, and a verse
  // a little below it, because a verse is subordinate writing and that lower
  // floor is where the room for it actually comes from. Under both, the
  // recession takes over.
  const verseFloor = Math.min(floor, W.verseFloorPx);
  const verseW = span * W.verseWidth;
  let headPx = head.fontPx;
  let headLines = head.lines;
  let fontPx = 0;
  let lead = 0;
  let band = 0;
  let broken: string[][] = [];
  for (;;) {
    fontPx = Math.max(verseFloor, half(headPx * W.verse));
    lead = fontPx * W.verseLine;
    headLines = wrapLines(text, maxW, (s) => measure(headPx, s));
    const headTall = headLines.length * headPx * W.line;
    band = Math.max(lead, maxH - headTall - lead * W.verseGap);
    broken = gathered.map((verse) => breakVerse(verse, verseW, fontPx, measure));
    const wanted = broken.reduce((n, v) => n + v.length, 0) * lead;
    if (headTall + lead * W.verseGap + wanted <= maxH || headPx <= floor) break;
    headPx = Math.max(floor, half(headPx - 0.5));
  }
  const headLead = headPx * W.line;
  const headH = headLines.length * headLead;

  // Newest first and, inside a verse, its last line first: the stack is built
  // from the bottom edge of the wing upward, because the bottom is where the
  // writing that is still being read lives and it is the one place that must
  // not move as older lines pile up behind it.
  //
  // `rank` is how many verses newer than this one there are: 0 for the one just
  // written, 1 for the one before it. It is what the recession steps on — per
  // verse and not per line, because a verse is one utterance and the two lines
  // of a sentence that happened to wrap belong to each other. Stepping per line
  // would pull a single sentence apart at its own line break while the sentence
  // was still perfectly legible, which reads as a fault rather than as age.
  const stack: { text: string; rank: number }[] = [];
  for (let v = broken.length - 1; v >= 0; v--) {
    const rank = broken.length - 1 - v;
    for (let i = broken[v].length - 1; i >= 0; i--) stack.push({ text: broken[v][i], rank });
  }

  // Every gap is scaled by the rank of the line *below* it, which falls out of
  // the two rules at once: inside a verse the rank does not change, and entering
  // an older verse the gap still belongs to the newer one. So the verse just
  // written keeps full leading between its own lines and a full line of clear
  // paper above it — a much-written wing must never write its history over the
  // top of the sentence somebody is still reading.
  const height = (r: number): number => {
    let total = 1; // the newest line's own height
    for (let i = 0; i < stack.length - 1; i++) total += Math.pow(r, stack[i].rank);
    return total;
  };
  const ratio = recession(height, band / lead, W.verseTight);

  const offsets: number[] = [];
  let offset = 0;
  for (let i = 0; i < stack.length; i++) {
    if (i > 0) offset += lead * Math.pow(ratio, stack[i - 1].rank);
    offsets.push(offset);
  }
  // Spacing and ink come off the one ratio, so ink laid into a vanishing space is
  // proportionally fainter and the total ink on a wing converges however many
  // verses arrive. `verseFade` is the only slack between them: below 1 it lets an
  // old verse stay readable for longer than it has room to be.
  const inkOf = (rank: number) => W.verseInk * Math.pow(ratio, rank * W.verseFade);

  // The last word on the block never leaving the paper. The recession is bounded
  // by `verseTight` and so this can only ever be a small squeeze, on a wing so
  // full that everything above the newest verse is a wash in any case — but
  // bounded is not the same as inside, and the writing has to be inside.
  let used = offsets[offsets.length - 1] + lead;
  if (used > band) {
    const squeeze = band / used;
    for (let i = 0; i < offsets.length; i++) offsets[i] *= squeeze;
    used = band;
  }
  const bottom = headH + lead * W.verseGap + used;
  const middle = bottom / 2;
  const top = headLead / 2 - middle;
  headLines.forEach((line, i) =>
    lines.push({ text: line, y: top + i * headLead, fontPx: headPx, ink: 1 }),
  );

  let nib: WingWriting["nib"] = null;
  for (let i = 0; i < stack.length; i++) {
    const y = bottom - lead / 2 - offsets[i] - middle;
    lines.push({ text: stack[i].text, y, fontPx, ink: inkOf(stack[i].rank) });
    // The pen rests at the end of the newest line of the verse being written,
    // which — the stack being built from the bottom up — is the first one here.
    if (i === 0 && writing !== null) {
      const wide = stack[i].text ? measure(fontPx, stack[i].text) : 0;
      nib = { x: wide / 2 + fontPx * 0.12, y, fontPx };
    }
  }
  return { rise, lines, nib };
}

// Never nothing: a verse that is still blank is one empty line, because that
// empty line is the offer.
function breakVerse(verse: string, maxWidth: number, fontPx: number, measure: Measure): string[] {
  const lines = wrapLines(verse, maxWidth, (s) => measure(fontPx, s));
  return lines.length > 0 ? lines : [""];
}

/**
 * How much tighter each verse sits than the one after it, and therefore how much
 * fainter.
 *
 * Exactly 1 while everything fits at full leading — a wing with two verses on it
 * has nothing cramped and nothing faded, and the fading must not start before
 * the room actually runs out. Below 1 once it does, solved so the whole stack
 * lands on the room there is.
 *
 * `height` is the stack's height in line heights at a given ratio, and it is
 * passed in rather than assumed, because the stack is not a plain geometric
 * series — the lines of one verse share a rank. It is monotone increasing in
 * `r`, which is the whole of what bisection needs.
 *
 * Floored, and the floor is what makes this bounded: a geometric series
 * converges, so however many verses arrive the stack above the newest one is
 * never taller than `lead / (1 - verseTight)`. Without it a very full wing would
 * drive the ratio to zero, pile its whole history onto one line, and take the
 * ink to nothing with it — which is deletion wearing the costume of a fade.
 */
function recession(height: (r: number) => number, room: number, tightest: number): number {
  if (height(1) <= room) return 1;
  if (height(tightest) >= room) return tightest;
  let lo = tightest;
  let hi = 1;
  // Runs once per layout, and a layout is cached per creature, so this is far
  // more bisection than the half pixel it is resolving needs.
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (height(mid) > room) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
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
 *
 * `alpha` is the wings opening and multiplies every line; each line's own `ink`
 * is how far it has receded. Nothing is skipped for being faint — a line that
 * has gone below what a screen can show is ink that has faded, and it is drawn
 * every frame like the rest.
 */
export function drawWingWriting(
  ctx: CanvasRenderingContext2D,
  writing: WingWriting,
  x: number,
  y: number,
  alpha: number,
  growth = 1,
): void {
  if (alpha <= 0.004 || writing.lines.length === 0) return;
  const middle = y - writing.rise * growth;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const line of writing.lines) {
    if (!line.text) continue;
    const ink = alpha * line.ink;
    if (ink <= 0.004) continue;
    ctx.font = fontOf(line.fontPx * growth);
    ctx.fillStyle = `rgba(${INK[0]},${INK[1]},${INK[2]},${Math.min(1, ink)})`;
    ctx.fillText(line.text, x, middle + line.y * growth);
  }
  ctx.restore();
}

/**
 * The nib, resting where the next character would go.
 *
 * It breathes rather than blinks — a hard blink is a text cursor in a form, and
 * this is a pen held over paper. The same pen the slip holds, because it is the
 * same act: a line being written on the same stock, once while it is flat and
 * once after it has been folded into a creature.
 *
 * It is also the whole of the offer. There is no button, no prompt and no
 * placeholder telling anyone a verse is expected, because most touches will not
 * carry one; there is a pen resting on a blank line, which is what a page open
 * on a desk looks like.
 */
export function drawWingNib(
  ctx: CanvasRenderingContext2D,
  writing: WingWriting,
  x: number,
  y: number,
  alpha: number,
  growth: number,
  pulse: number,
): void {
  const nib = writing.nib;
  if (!nib || alpha <= 0.004) return;
  const fontPx = nib.fontPx * growth;
  const cx = x + nib.x * growth;
  const cy = y - writing.rise * growth + nib.y * growth;
  ctx.save();
  ctx.strokeStyle = `rgba(${INK[0]},${INK[1]},${INK[2]},${Math.min(1, alpha * pulse)})`;
  ctx.lineWidth = Math.max(0.8, fontPx * 0.06);
  ctx.beginPath();
  ctx.moveTo(cx, cy - fontPx * 0.42);
  ctx.lineTo(cx, cy + fontPx * 0.42);
  ctx.stroke();
  ctx.restore();
}

function half(v: number): number {
  return Math.round(v * 2) / 2;
}
