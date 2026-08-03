// The other half of the one verb.
//
// CLAUDE.md, Touching: "A butterfly comes to the cursor, lands, and opens its
// wings to show the text written on their inner surface. Colour returns to full
// with a small bloom. Optionally, one verse may be added."
//
// A kigo in a real saijiki is a season word with example poems gathering
// underneath it. Without this a butterfly could be affirmed but never explained
// — there was nowhere to say *why* it is still true, and no way for the wings to
// become more written over the years.
//
// --- the offer is the affirming ----------------------------------------------
//
// There is no button, and there must not be one. Clicking a landed butterfly
// already means *still true*; what it now also does is open a blank line on the
// wing with a pen resting on it. Type and press Enter to keep what you wrote;
// press Escape, or move the pointer away, and the touch stands alone with
// nothing written.
//
// Most touches will be silent, and the whole design of this file is bent toward
// making that feel like the ordinary case rather than like a step that was
// skipped. So: no placeholder, no prompt, no "add a verse", nothing greyed out
// waiting to be filled in, and nothing at all that appears on a butterfly
// nobody has clicked. What there is, is a pen resting on paper, which is what a
// page open on a desk looks like — an invitation that asks for nothing.
//
// It is also why the touch is written *before* a verse is offered rather than
// after: the affirmation is already true and already on disk by the time this
// blank line appears, so walking away from it costs nothing and is not a
// cancellation of anything. Nothing here can fail in a way that loses a touch.
//
// --- append only --------------------------------------------------------------
//
// No editing, no deleting, no reordering, and no way to reach a verse that has
// already been written. The file is plain markdown and anybody who really means
// to change one can open it in Notepad, which is exactly the right amount of
// friction: you do not revise a record of what was true.
//
// --- and the field is the slip's ----------------------------------------------
//
// writing.ts's, the same one the recording ceremony uses, under the same cap. A
// verse is written on the same paper as the season word above it and there is no
// more of it, so it takes the same limit — and it takes it from wing-text rather
// than from a number chosen here.

import type { Knob } from "./tuning-panel";
import {
  WING_TEXT,
  drawWingNib,
  drawWingWriting,
  layoutWings,
  fontOf,
  type Measure,
  type WingWriting,
} from "./wing-text";
import { createField } from "./writing";

export const VERSE = {
  // One breath of the pen, in seconds. The slip's own `caretSec`, deliberately
  // the same number in two places rather than one shared one: they are two
  // surfaces and the panel wants to be able to disagree about them.
  caretSec: 1.6,
};

/** What a verse needs of a butterfly: its writing, and which creature it is. */
export interface Written {
  id: string;
  text: string;
  verses: readonly string[];
}

export interface VerseOptions {
  /**
   * Keep this line. The store layer, injected so this module can be exercised
   * without a disk — and so the write itself stays main.ts's, next to the touch
   * it belongs to.
   */
  add(id: string, verse: string): void;
}

let options: VerseOptions | null = null;

export function initVerse(next: VerseOptions): void {
  options = next;
}

// --- the offer ---------------------------------------------------------------

let offered: string | null = null;
let line = "";
let breath = 0;

const field = createField({
  className: "verse-input",
  onChange: (text) => {
    line = text;
  },
  onConfirm: () => confirmVerse(),
  onCancel: () => endVerse(),
});

/**
 * A butterfly has just been told it is still true. Open a line on its wing.
 *
 * Called again for the one already being written to — a second click on a
 * creature that is already holding a pen is somebody clicking to get the focus
 * back, not somebody starting again — so it never throws away words.
 */
export function offerVerse(id: string): void {
  if (offered === id) {
    field.focus();
    return;
  }
  offered = id;
  line = "";
  breath = 0;
  field.open("");
}

/**
 * Escape, or the creature going home. The touch stands; nothing is written.
 *
 * Deliberately silent about what was typed. A verse that was abandoned is not a
 * draft to be restored later — there is no draft anywhere in this app — and
 * remembering it would mean the next touch of the same kigo opened with somebody
 * else's half-sentence already on the wing.
 */
export function endVerse(): void {
  if (offered === null) return;
  offered = null;
  line = "";
  field.close();
}

/**
 * Enter.
 *
 * Append only: this hands the store one more line and can do nothing else.
 * There is no way from here to edit, delete or reorder what is already on the
 * wing, and there should not be one — the file is plain markdown and anybody who
 * really means to change a verse can open it in Notepad, which is exactly the
 * right amount of friction for revising a record of what was true.
 */
export function confirmVerse(): void {
  const id = offered;
  const text = line.trim();
  // Nothing written is the ordinary case, and Enter on an empty line is
  // somebody saying so. It closes, and it is not a failure of anything: the
  // touch was made and written before this line ever opened.
  if (id !== null && text) options?.add(id, text);
  endVerse();
}

/** What the field says, cleaned up and capped. See writing.ts's `oneLine`. */
export function writeVerse(text: string): void {
  field.write(text);
}

/** Which butterfly is holding a pen, if any. */
export function verseOfferedTo(): string | null {
  return offered;
}

/**
 * The line being written, for the wing to lay out — and `null` when there is
 * none, which is what tells wing-text whether to open a blank line at all.
 */
export function versePending(id: string): string | null {
  return offered === id ? line : null;
}

/** The pen's own clock. Off the frame's dt like everything else that moves. */
export function stepVerse(dt: number): void {
  if (offered !== null && dt > 0) breath += dt;
}

// --- the writing on the wings -------------------------------------------------

/**
 * Everything on the inner surface: the season word, the verses under it, the one
 * being written, and the pen.
 *
 * Drawn over the creature's tile rather than into it. The seed rule says the
 * geometry comes from the id and nothing else, and a butterfly whose sprite
 * sheet depended on its writing would rebuild itself every time a verse was
 * added — which is also why this costs nothing in the tile cache however much
 * is written: one creature, one size, and the ink goes on afterwards.
 *
 * `span` is the size the layout was fitted to and `growth` is how large it is
 * being drawn right now against that. The ink is on the paper: it comes nearer
 * with the paper and it never re-breaks under the reader.
 *
 * The hidden field is placed here too, because here is where the pen's position
 * is known — an IME puts its candidate window at the caret, and the caret is
 * wherever the last line of the verse being written happens to have landed.
 */
export function drawWings(
  ctx: CanvasRenderingContext2D,
  written: Written,
  x: number,
  y: number,
  span: number,
  alpha: number,
  growth: number,
): void {
  if (!written.text && written.verses.length === 0 && offered !== written.id) return;
  const writing = layoutFor(written, span, ctx);
  drawWingWriting(ctx, writing, x, y, alpha, growth);
  if (offered !== written.id) return;
  // It breathes rather than blinks. See `drawWingNib`.
  const breaths = breath / Math.max(0.05, VERSE.caretSec);
  const pulse = 0.35 + 0.45 * (0.5 + 0.5 * Math.cos(breaths * Math.PI * 2));
  drawWingNib(ctx, writing, x, y, alpha, growth, pulse);
  placeField(writing, x, y, span, growth);
}

// Over the words, at the size they are drawn. Really there and really that size
// — see writing.ts on why it is not parked off-screen.
function placeField(
  writing: WingWriting,
  x: number,
  y: number,
  span: number,
  growth: number,
): void {
  const nib = writing.nib;
  if (!nib) return;
  const fontPx = Math.max(7, nib.fontPx * growth);
  const w = span * WING_TEXT.verseWidth * growth;
  field.place({
    x: x - w / 2,
    y: y - writing.rise * growth + nib.y * growth - fontPx,
    w,
    h: fontPx * 2,
    fontPx,
  });
}

// Laid out once per creature rather than per frame: fitting a block costs a few
// dozen measurements, and since the layout is made at the landed span and then
// merely scaled, there is exactly one of them per visit.
//
// The verse being written is in the key, so the block genuinely re-settles as
// the words arrive — which is the only honest way to show somebody how much room
// they have left. That is one layout per keystroke and it is the one moment in
// this app where that is cheap: one creature, standing still, while a person
// types.
//
// The reading constants are in the key rather than being a rebuild knob, because
// they change the *words* and nothing else — throwing away a hundred and fifty
// butterflies' sprite sheets to move a line height would be a very expensive way
// to answer a slider.
const layouts = new Map<string, WingWriting>();

/** The pose table was rebuilt, so the span a layout was fitted to may have moved. */
export function clearWingLayouts(): void {
  layouts.clear();
}

function layoutFor(
  written: Written,
  span: number,
  ctx: CanvasRenderingContext2D,
): WingWriting {
  const T = WING_TEXT;
  const pending = versePending(written.id);
  const key =
    `${written.id}|${span}|${JSON.stringify(T)}|${written.text} ` +
    `${written.verses.join(" ")} ${pending ?? ""}`;
  let writing = layouts.get(key);
  if (!writing) {
    const measure: Measure = (fontPx, s) => {
      ctx.save();
      ctx.font = fontOf(fontPx);
      const w = ctx.measureText(s).width;
      ctx.restore();
      return w;
    };
    writing = layoutWings(written.text, written.verses, pending, span, measure);
    if (layouts.size > 64) layouts.clear();
    layouts.set(key, writing);
  }
  return writing;
}

// --- the overlay and the panel ------------------------------------------------

/** One line for F9. Says whether a pen is out and how much of the cap is spent. */
export function verseStatus(): string {
  if (offered === null) return "verse: —";
  // The words themselves never appear here. They are somebody's diary, and the
  // overlay ends up in screenshots.
  return `verse: ${offered} · ${[...line].length} written`;
}

export function verseKnobs(): Knob[] {
  const V = VERSE as unknown as Record<string, number>;
  return [
    {
      group: "reading",
      label: "caretSec",
      min: 0.4,
      max: 4,
      step: 0.05,
      get: () => V.caretSec,
      set: (v) => {
        V.caretSec = v;
      },
    },
  ];
}
