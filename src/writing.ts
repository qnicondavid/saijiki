// The hand: one hidden input, and the cap the wings put on it.
//
// Two places in this app take words — the slip, when a kigo is recorded, and
// the wing, when one is affirmed — and they take them the same way, under the
// same cap, for the same reason. This is that, once, so there is no second copy
// to drift: an IME guard that was fixed in one place and not the other would
// show up as a Japanese keyboard that works on the slip and not on the wing,
// which is exactly the kind of bug nobody who tests in English ever sees.
//
// --- the input is a real input ----------------------------------------------
//
// The typing goes through a hidden DOM `<input>` positioned over the writing,
// not through key handlers. That buys IME support, and it is not optional: this
// is a Japanese form, wing-text goes to the trouble of breaking Japanese, and an
// app that could render 夕餉のあいだ台所に携帯を置いておく but not let anyone type it would
// be a strange sort of almanac. The input is transparent and the words are drawn
// in ink on the canvas; it is positioned over the writing rather than parked
// off-screen so the IME's candidate window comes up where the words are.
//
// --- the cap ----------------------------------------------------------------
//
// One number, asked of the wings rather than picked. A kigo that its own
// butterfly could not show you must not be recordable, and a verse is subject to
// the same limit and for the same reason — it is written on the same paper, and
// the paper is the same size.

import { HANDWRITING, WING_TEXT, wingTextBudget } from "./wing-text";

/**
 * How many characters either field will take.
 *
 * Derived even before there is a canvas to measure with, because a number
 * picked here could drift away from what the wings actually hold and nobody
 * would find out. An ideograph is one em wide by definition, which is exactly
 * the conservative assumption `wingTextBudget` is built on — so measuring
 * against a nominal em gives the right answer without a font. `measureWriting`
 * refines it once the machine's own hand is known.
 */
let cap = wingTextBudget(WING_TEXT.span, (fontPx, text) => [...text].length * fontPx);

export function writingCap(): number {
  return cap;
}

/**
 * Recompute the cap against the hand this machine actually has.
 *
 * Needs a canvas to measure with, so it is done once the app has one rather
 * than at import. The default above is a safe understatement for the shipped
 * span; it is only ever in force if this is never called.
 *
 * Returns the new cap so a caller holding a half-written line can re-clip it.
 */
export function measureWriting(ctx: CanvasRenderingContext2D): number {
  cap = wingTextBudget(WING_TEXT.span, (fontPx, text) => {
    ctx.save();
    ctx.font = `${fontPx}px ${HANDWRITING}`;
    const w = ctx.measureText(text).width;
    ctx.restore();
    return w;
  });
  return cap;
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
 *
 * Exported and pure, so both the flattening and the counting can be tested
 * without a DOM.
 */
export function oneLine(text: string, composing = false): string {
  const flat = text.replace(/[\r\n\t\v\f\u2028\u2029]+/gu, " ");
  return composing ? flat : [...flat].slice(0, cap).join("");
}

export interface FieldOptions {
  /** The class style.css dresses it in. */
  className: string;
  /** Whatever is in it now, cleaned and capped. Called on every keystroke. */
  onChange(text: string): void;
  /** Enter, and never while an IME is composing. */
  onConfirm(): void;
  /** Escape. */
  onCancel(): void;
  /** Anything else this particular field wants. True if it took the key. */
  onKey?(e: KeyboardEvent): boolean;
}

/** Where a field sits on the glass, in css px. */
export interface FieldBox {
  x: number;
  y: number;
  w: number;
  h: number;
  fontPx: number;
}

export interface Field {
  /** What has been typed. */
  text(): string;
  /** Is it taking words? */
  isOpen(): boolean;
  /** Is an IME mid-composition? The caller may want to leave it alone. */
  isComposing(): boolean;
  open(text?: string): void;
  close(): void;
  /** A click landed somewhere else and took the focus with it. Take it back. */
  focus(): void;
  place(box: FieldBox): void;
  /** Put a value in from outside — a re-clip after the cap moved, mostly. */
  write(text: string): void;
}

function hasDom(): boolean {
  return typeof document !== "undefined";
}

/**
 * One hidden field.
 *
 * Made lazily and kept: an app that has recorded once will record again, and a
 * field that survives is a field whose focus behaviour is the same on the second
 * use as on the first. It is also entirely absent until something asks — the
 * suite has no DOM, and neither does the seeder.
 */
export function createField(options: FieldOptions): Field {
  let el: HTMLInputElement | null = null;
  let line = "";
  let composing = false;
  let open = false;

  function write(text: string): void {
    const capped = oneLine(text, composing);
    line = capped;
    if (el && el.value !== capped) el.value = capped;
    options.onChange(capped);
  }

  function make(): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "text";
    input.className = options.className;
    input.autocomplete = "off";
    input.spellcheck = false;
    // `inputMode` and the lack of a maxLength are both deliberate: an IME needs
    // to be able to overrun briefly while composing, and the cap is applied on
    // the way out instead. See `oneLine`.
    input.addEventListener("compositionstart", () => {
      composing = true;
    });
    input.addEventListener("compositionend", () => {
      composing = false;
      write(input.value);
    });
    input.addEventListener("input", () => write(input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (!composing) options.onConfirm();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        options.onCancel();
      } else if (options.onKey?.(e)) {
        e.preventDefault();
        e.stopPropagation();
      } else {
        e.stopPropagation(); // dev keys are not shortcuts while someone is writing
      }
    });
    document.body.appendChild(input);
    return input;
  }

  return {
    text: () => line,
    isOpen: () => open,
    isComposing: () => composing,

    open(text = "") {
      open = true;
      line = text;
      if (!hasDom()) return;
      el ??= make();
      el.value = line;
      el.style.display = "block";
      el.focus({ preventScroll: true });
    },

    close() {
      open = false;
      composing = false;
      line = "";
      if (!el) return;
      el.blur();
      el.style.display = "none";
    },

    focus() {
      if (open) el?.focus({ preventScroll: true });
    },

    // Really there and really that size, rather than parked off-screen: an IME
    // puts its candidate window at the caret, and a field in the corner of the
    // desktop would put the候補 list there too instead of under the words.
    place(box) {
      if (!el) return;
      el.style.left = `${Math.round(box.x)}px`;
      el.style.top = `${Math.round(box.y)}px`;
      el.style.width = `${Math.round(Math.max(8, box.w))}px`;
      el.style.height = `${Math.round(Math.max(8, box.h))}px`;
      el.style.fontSize = `${Math.round(box.fontPx)}px`;
    },

    write,
  };
}
