// Breaking a line so it fits on a pair of wings.
//
// The measuring is the caller's — a canvas metric in the app, a stand-in here —
// which is what makes any of this testable at all. What is pinned below is the
// breaking itself, and the two ways it goes wrong: a word wider than the wing,
// which has to be cut through rather than allowed to run off the edge, and a
// language with no spaces in it, where the whole entry is one such word.

import { describe, expect, it } from "vitest";
import {
  HANDWRITING,
  WING_TEXT,
  layoutWingText,
  layoutWings,
  wingTextBudget,
  wrapLines,
} from "./wing-text";

// A monospace stand-in: one unit per code point, `size` units wide at `size` px.
const measure = (fontPx: number, text: string) => [...text].length * fontPx * 0.5;
const at = (fontPx: number) => (text: string) => measure(fontPx, text);

describe("wrapping a line onto the wings", () => {
  it("has nothing to say about nothing", () => {
    expect(wrapLines("", 100, at(10))).toEqual([]);
    expect(wrapLines("   ", 100, at(10))).toEqual([]);
  });

  it("keeps a line that fits on one line", () => {
    expect(wrapLines("phone in the kitchen", 200, at(10))).toEqual(["phone in the kitchen"]);
  });

  it("breaks at spaces, and never past the width", () => {
    const width = 60; // twelve characters at 10px
    const lines = wrapLines("leaving my phone in the kitchen at dinner", width, at(10));
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(measure(10, line)).toBeLessThanOrEqual(width);
    expect(lines.join(" ")).toBe("leaving my phone in the kitchen at dinner");
  });

  it("cuts through a word too long to fit on a line of its own", () => {
    // Better a word broken across two lines than one that runs off the wing.
    const lines = wrapLines("supercalifragilistic", 40, at(10));
    for (const line of lines) expect(measure(10, line)).toBeLessThanOrEqual(40);
    expect(lines.join("")).toBe("supercalifragilistic");
  });

  it("breaks Japanese, which has no spaces to break at", () => {
    // Not an edge case: a saijiki is a Japanese form and an entry written in it
    // arrives as one unbroken "word".
    const text = "夕餉のあいだ台所に携帯を置いておく";
    const lines = wrapLines(text, 40, at(10));
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(measure(10, line)).toBeLessThanOrEqual(40);
    expect(lines.join("")).toBe(text);
  });

  it("never splits a surrogate pair down the middle", () => {
    const lines = wrapLines("𠮟𠮟𠮟𠮟", 20, at(10));
    expect(lines.join("")).toBe("𠮟𠮟𠮟𠮟");
    for (const line of lines) expect([...line].every((c) => c.length === 2)).toBe(true);
  });
});

describe("fitting the line to the creature", () => {
  const line = "leaving my phone in the kitchen at dinner";

  it("shrinks the hand until the block fits the patch of wing it is allowed", () => {
    const span = 190;
    const layout = layoutWingText(line, span, measure);
    expect(layout.lines.length).toBeGreaterThan(0);
    expect(layout.lines.length * layout.lineHeight).toBeLessThanOrEqual(span * WING_TEXT.height);
    for (const l of layout.lines) {
      expect(measure(layout.fontPx, l)).toBeLessThanOrEqual(span * WING_TEXT.width);
    }
  });

  it("is comfortably readable at the size a butterfly lands at", () => {
    // The whole reason a butterfly has to come to the cursor at all. If this
    // ever drops to the floor at the shipped span, the creature is too small
    // rather than the entry too long.
    const layout = layoutWingText(line, 190, measure);
    expect(layout.fontPx).toBeGreaterThanOrEqual(13);
  });

  it("stops shrinking rather than becoming a smudge", () => {
    // A very long entry on a small creature overflows its box instead of going
    // below the point of being ink at all. Entries are one line; this is a
    // backstop, not the common case.
    const essay = Array.from({ length: 60 }, () => "still").join(" ");
    const layout = layoutWingText(essay, 60, measure);
    expect(layout.fontPx).toBeGreaterThanOrEqual(WING_TEXT.floorPx);
  });

  it("bundles no font, and falls back to something readable", () => {
    // The repository is public and a font licence is not a decision to make in
    // passing, so the face is whatever the machine already has — and the tail
    // of the stack has to be a book face rather than a generic `cursive`, which
    // resolves to the default sans on most Linux boxes.
    expect(HANDWRITING).toMatch(/serif$/);
    expect(HANDWRITING).toContain("Segoe Script"); // Windows
    expect(HANDWRITING).toContain("Bradley Hand"); // macOS
  });
});

describe("how much a pair of wings will hold", () => {
  // The recording slip caps its input at this, and the cap is the point: the
  // medium enforces the brevity, so a kigo can never be recorded that its own
  // butterfly could not show you.
  //
  // These need a different stand-in from the block above. The monospace one is
  // right for testing where a line *breaks*, but it is exactly wrong here: the
  // budget is measured against a full-em ideograph and paid for by real letters
  // being about half that, and a measure where every glyph is the same width
  // erases that margin and with it the only thing worth checking. So this one
  // has the relative widths a hand actually draws.
  const hand = (fontPx: number, text: string): number =>
    [...text].reduce((w, ch) => {
      const em = ch === " " ? 0.26 : /[　-鿿぀-ヿ]/u.test(ch) ? 1 : /[A-Z]/.test(ch) ? 0.72 : 0.5;
      return w + em * fontPx;
    }, 0);

  const span = 190; // the wingspan a butterfly lands and opens at
  const budget = wingTextBudget(span, hand);

  const fits = (text: string): boolean => {
    const layout = layoutWingText(text, span, hand);
    const tooWide = layout.lines.some((l) => hand(layout.fontPx, l) > span * WING_TEXT.width + 1e-9);
    const tooTall = layout.lines.length * layout.lineHeight > span * WING_TEXT.height + 1e-9;
    return !tooWide && !tooTall;
  };

  it("is enough for a real entry", () => {
    // CLAUDE.md's own example. If the cap ever falls below this, the app has
    // stopped being able to record the thing it was designed around.
    expect(budget).toBeGreaterThanOrEqual([..."leaving my phone in the kitchen at dinner"].length);
  });

  it("holds a line of it in any script, packed solid", () => {
    expect(fits("漢".repeat(budget))).toBe(true);
    expect(fits("ぬ".repeat(budget))).toBe(true);
    expect(fits("W".repeat(budget))).toBe(true);
  });

  it("holds a line of it once wrapping has taken its cut", () => {
    // Breaking at spaces strands a few characters at the end of every line, and
    // the worst case is words a little over half a line long — one to a line,
    // half the width wasted. The margin has to cover even that.
    for (const wordLen of [1, 3, 5, 8, 11, 14, 20]) {
      const text = Array.from({ length: budget }, (_, i) =>
        (i + 1) % (wordLen + 1) === 0 ? " " : "m",
      )
        .join("")
        .trim();
      expect(fits(text), `words of ${wordLen} overflowed`).toBe(true);
    }
  });

  it("holds fewer on a smaller creature", () => {
    expect(wingTextBudget(90, hand)).toBeLessThan(budget);
    expect(wingTextBudget(40, hand)).toBeGreaterThanOrEqual(1);
  });
});

describe("the wings filling up", () => {
  // The palimpsest, and the part of this step worth getting right. Verses
  // accumulate for years and a wing is small, so every promise below is about a
  // state that takes a decade of real use to reach and that nobody will be
  // looking at when it breaks. /dev/wing.html is how it is looked at; this is
  // what is true about it.
  //
  // Relative glyph widths matter here — the whole question is how much writing
  // fits — so this is the hand-shaped stand-in rather than the monospace one.
  const hand = (fontPx: number, text: string): number =>
    [...text].reduce((w, ch) => w + (ch === " " ? 0.26 : /[A-Z]/.test(ch) ? 0.72 : 0.5) * fontPx, 0);

  const span = WING_TEXT.span;
  const KIGO = "leaving my phone in the kitchen at dinner";
  const verses = (n: number) =>
    Array.from({ length: n }, (_, i) => `still doing it and dinner is longer now, take ${"x".repeat(i % 3)}`);
  const lay = (n: number, writing: string | null = null) =>
    layoutWings(KIGO, verses(n), writing, span, hand);

  // The season word is the only thing on a wing at full ink; anything below that
  // is a verse. That is not a coincidence being leaned on — it is one of the
  // claims made below.
  type Laid = ReturnType<typeof lay>;
  const head = (l: Laid) => l.lines.filter((line) => line.ink === 1);
  const under = (l: Laid) => l.lines.filter((line) => line.ink < 1);

  const COUNTS = [0, 1, 2, 3, 6, 12, 30, 100];

  it("shows one line centred on the fold when nothing has been added", () => {
    // The picture a wing has always shown, and it must not drift: it is what
    // every butterfly in a first year of real use looks like.
    const alone = layoutWings(KIGO, [], null, span, hand);
    const solo = layoutWingText(KIGO, span, hand);
    expect(alone.lines.map((l) => l.text)).toEqual(solo.lines);
    expect(alone.lines.every((l) => l.fontPx === solo.fontPx)).toBe(true);
    expect(alone.lines.every((l) => l.ink === 1)).toBe(true);
    expect(alone.nib).toBeNull();
    const ys = alone.lines.map((l) => l.y);
    expect(Math.min(...ys)).toBeCloseTo(-Math.max(...ys), 6);
  });

  it("never removes a verse, however many have gathered", () => {
    // The whole of "nothing is ever removed". Not paginated, not scrolled, not
    // truncated: a hundred verses is a hundred verses' worth of writing on the
    // wing, however faint the oldest of it has gone.
    for (const n of COUNTS) {
      const written = under(lay(n))
        .map((l) => l.text)
        .join(" ");
      for (const verse of verses(n)) {
        for (const word of verse.split(" ")) {
          expect(written, `${n} verses lost "${word}"`).toContain(word);
        }
      }
    }
  });

  it("keeps every line of writing on the paper", () => {
    // The block may fill the wing and may not leave it. A line drawn past the
    // patch is a line off the edge of a creature that tapers, which reads as a
    // mistake rather than as a style.
    const halfH = (span * WING_TEXT.height) / 2;
    const halfW = (span * WING_TEXT.width) / 2;
    for (const n of COUNTS) {
      for (const line of lay(n).lines) {
        expect(Math.abs(line.y), `${n} verses ran off the wing`).toBeLessThanOrEqual(halfH);
        expect(hand(line.fontPx, line.text) / 2).toBeLessThanOrEqual(halfW + 1e-9);
      }
    }
  });

  it("leaves the season word the most prominent thing on it", () => {
    // It is the kigo. The verses are underneath it — smaller, lighter, lower —
    // and no amount of writing may invert that.
    for (const n of COUNTS) {
      const laid = lay(n);
      const kigo = head(laid);
      expect(kigo.length, `${n} verses lost the season word`).toBeGreaterThan(0);
      expect(kigo.map((l) => l.text).join(" ")).toContain("kitchen");
      const lowest = Math.max(...kigo.map((l) => l.y));
      for (const line of under(laid)) {
        expect(line.fontPx, `${n} verses out-wrote the season word`).toBeLessThan(kigo[0].fontPx);
        expect(line.ink).toBeLessThan(1);
        expect(line.y).toBeGreaterThan(lowest);
      }
    }
  });

  it("shrinks the hand toward the floor as they gather, and stops there", () => {
    // "The block tightens and the hand shrinks toward wing-text's floor." Both
    // hands give ground — the season word very nearly fills this patch on its
    // own, so a verse arriving is exactly the moment it has to give some back —
    // and neither goes below the point of being ink at all.
    const floor = Math.max(WING_TEXT.floorPx, span * WING_TEXT.fontMin);
    const sizes = COUNTS.map((n) => head(lay(n))[0].fontPx);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i], `${COUNTS[i]} verses grew the hand`).toBeLessThanOrEqual(sizes[i - 1]);
    }
    expect(sizes[0]).toBeGreaterThan(sizes[sizes.length - 1]);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(floor);
    const verseFloor = Math.min(floor, WING_TEXT.verseFloorPx);
    for (const n of COUNTS) {
      for (const line of under(lay(n))) expect(line.fontPx).toBeGreaterThanOrEqual(verseFloor);
    }
  });

  it("fades nothing while there is still room for it", () => {
    // The fading happens *past* the point where tightening runs out, and not
    // before. A wing with one verse on it has a history of exactly one thing and
    // none of it has aged.
    const one = under(lay(1));
    expect(one.length).toBeGreaterThan(0);
    for (const line of one) expect(line.ink).toBeCloseTo(WING_TEXT.verseInk, 6);
  });

  it("makes the older ones fainter, and never the reverse", () => {
    // How old a verse is, is said by how faint its ink has gone — so the order
    // has to be exact. Two verses at one ink would be two moments the wing could
    // not tell apart.
    for (const n of [3, 6, 12, 30]) {
      const inks = under(lay(n)).map((l) => l.ink);
      // laid out newest first, so ink may only weaken going up the wing
      for (let i = 1; i < inks.length; i++) {
        expect(inks[i], `${n} verses: older ink was darker`).toBeLessThanOrEqual(inks[i - 1]);
      }
      expect(inks[inks.length - 1]).toBeLessThan(inks[0]);
    }
  });

  it("fades rather than disappears: the oldest ink is faint and still there", () => {
    // "Grow fainter rather than disappearing." Ink that has receded a long way is
    // still ink — drawn every frame like the rest — and it is what makes a
    // much-written butterfly visibly one before a word of it has been read.
    for (const n of [12, 30, 100]) {
      const inks = under(lay(n)).map((l) => l.ink);
      expect(Math.min(...inks)).toBeGreaterThan(0);
      expect(Math.min(...inks)).toBeLessThan(0.2);
    }
  });

  it("never lets the wash swallow the verse just written", () => {
    // The recession steps per verse and the newest has rank zero, so its own
    // lines keep full leading and a full line of clear paper above them. A wing
    // that wrote its history over the top of the sentence somebody was still
    // reading would have the whole thing backwards.
    for (const n of [2, 3, 6, 12, 30, 100]) {
      const verse = under(lay(n));
      const newest = verse.filter((l) => l.ink === verse[0].ink);
      const lead = verse[0].fontPx * WING_TEXT.verseLine;
      expect(newest.length).toBeGreaterThan(0);
      for (let i = 1; i < newest.length; i++) {
        expect(newest[i - 1].y - newest[i].y, `${n} verses crowded the newest`).toBeCloseTo(lead, 1);
      }
      const above = verse[newest.length];
      if (above) {
        const air = newest[newest.length - 1].y - above.y;
        expect(air, `${n} verses left the newest no air`).toBeGreaterThan(lead * 0.9);
      }
    }
  });

  it("converges, so the ink on a wing is bounded however much is written", () => {
    // Spacing and ink come off one ratio, so writing packed into a vanishing
    // space is proportionally fainter. That is what stops a wing written on for a
    // decade from becoming a black smear — which would take the older writing
    // away far more thoroughly than deleting it would.
    const total = (n: number) => under(lay(n)).reduce((sum, l) => sum + l.ink, 0);
    const many = total(30);
    expect(total(100)).toBeLessThan(many * 1.25);
    expect(many).toBeLessThan(8);
  });

  it("opens a blank line with the pen on it, and nothing else", () => {
    // The offer, and the whole of it: no placeholder, no prompt, no label. A pen
    // resting on blank paper, which asks for nothing.
    const waiting = lay(1, "");
    const before = lay(1);
    expect(waiting.nib).not.toBeNull();
    expect(under(waiting).length).toBe(under(before).length + 1);
    expect(under(waiting).some((l) => l.text === "")).toBe(true);
    expect(before.nib).toBeNull();
  });

  it("lays the line being written as the newest verse, under the pen", () => {
    // It re-settles as the words arrive, which is the only honest way to show
    // somebody how much room they have left.
    const typing = lay(2, "and it is still true");
    const verse = under(typing);
    expect(verse[0].text).toContain("still true");
    expect(verse[0].ink).toBe(Math.max(...verse.map((l) => l.ink)));
    expect(typing.nib!.y).toBeCloseTo(verse[0].y, 6);
    expect(typing.nib!.x).toBeGreaterThan(hand(verse[0].fontPx, verse[0].text) / 2);
  });

  it("says nothing about when any of it was written", () => {
    // No dates on the wing, ever. How old a verse is, is already said by how
    // faint its ink has gone, and a date would be a number in an app that has
    // spent its whole design avoiding them.
    const laid = layoutWings(KIGO, ["still true", "harder in winter"], null, span, hand);
    const written = laid.lines.map((l) => l.text).join(" ");
    expect(written).not.toMatch(/\d/u);
  });
});
