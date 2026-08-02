// Breaking a line so it fits on a pair of wings.
//
// The measuring is the caller's — a canvas metric in the app, a stand-in here —
// which is what makes any of this testable at all. What is pinned below is the
// breaking itself, and the two ways it goes wrong: a word wider than the wing,
// which has to be cut through rather than allowed to run off the edge, and a
// language with no spaces in it, where the whole entry is one such word.

import { describe, expect, it } from "vitest";
import { HANDWRITING, WING_TEXT, layoutWingText, wrapLines } from "./wing-text";

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
