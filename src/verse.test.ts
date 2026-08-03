// The second half of the one verb.
//
// What a verse looks like on a wing is wing-text's, and is pinned there. This is
// the offer: when it appears, what keeping one does, and — the part that matters
// most and is the easiest to break without noticing — what walking away from one
// does, which must be nothing at all.
//
// Everything runs against an injected `add`, so the suite has no route to
// anybody's store even if something in here is wrong.

import { afterEach, describe, expect, it } from "vitest";
import {
  confirmVerse,
  endVerse,
  initVerse,
  offerVerse,
  versePending,
  verseOfferedTo,
  verseStatus,
  writeVerse,
} from "./verse";
import { writingCap } from "./writing";

function fresh(): { kept: { id: string; verse: string }[] } {
  const kept: { id: string; verse: string }[] = [];
  initVerse({ add: (id, verse) => kept.push({ id, verse }) });
  return { kept };
}

afterEach(() => endVerse());

describe("offering a verse", () => {
  it("offers nothing until something is touched", () => {
    // Nothing on the sheet says a verse can be written. A butterfly that has not
    // been clicked shows its season word and nothing else.
    fresh();
    expect(verseOfferedTo()).toBeNull();
    expect(versePending("k_one")).toBeNull();
  });

  it("opens a blank line on the one that was touched, and only that one", () => {
    fresh();
    offerVerse("k_one");
    expect(verseOfferedTo()).toBe("k_one");
    // Blank, not absent: the empty string is what tells the wing to open a line
    // and rest a pen on it, and `null` is what tells it not to.
    expect(versePending("k_one")).toBe("");
    expect(versePending("k_two")).toBeNull();
  });

  it("keeps what was written, on the kigo it was written on", () => {
    const { kept } = fresh();
    offerVerse("k_one");
    writeVerse("still doing it, and dinner is longer now");
    confirmVerse();
    expect(kept).toEqual([{ id: "k_one", verse: "still doing it, and dinner is longer now" }]);
    // and the offer is over: one touch, one verse, and no line left open
    expect(verseOfferedTo()).toBeNull();
  });

  it("writes nothing when nothing was written, and that is the ordinary case", () => {
    // Most touches are silent. Pressing Enter on a blank line is somebody saying
    // so, and it must not read as a failure of anything — the touch was made and
    // written before this line ever opened.
    const { kept } = fresh();
    offerVerse("k_one");
    confirmVerse();
    expect(kept).toEqual([]);
    expect(verseOfferedTo()).toBeNull();
  });

  it("writes nothing on a line of pure whitespace", () => {
    const { kept } = fresh();
    offerVerse("k_one");
    writeVerse("   ");
    confirmVerse();
    expect(kept).toEqual([]);
  });

  it("writes nothing when it is walked away from", () => {
    // Escape, or the creature going home. The touch stands alone.
    const { kept } = fresh();
    offerVerse("k_one");
    writeVerse("a thing I thought better of");
    endVerse();
    expect(kept).toEqual([]);
    expect(verseOfferedTo()).toBeNull();
  });

  it("keeps no draft of what was abandoned", () => {
    // There is no draft anywhere in this app. Remembering one would mean the next
    // touch of the same kigo opened with somebody's half-sentence already on the
    // wing, which is worse than losing it.
    fresh();
    offerVerse("k_one");
    writeVerse("half a sentence");
    endVerse();
    offerVerse("k_one");
    expect(versePending("k_one")).toBe("");
  });

  it("does not start again when the same one is clicked twice", () => {
    // A second click on a creature already holding a pen is somebody reaching for
    // the focus, not somebody starting over.
    fresh();
    offerVerse("k_one");
    writeVerse("most of a sentence");
    offerVerse("k_one");
    expect(versePending("k_one")).toBe("most of a sentence");
  });

  it("moves the pen when a different one is touched", () => {
    fresh();
    offerVerse("k_one");
    writeVerse("about the first");
    offerVerse("k_two");
    expect(verseOfferedTo()).toBe("k_two");
    expect(versePending("k_one")).toBeNull();
    expect(versePending("k_two")).toBe("");
  });

  it("appends and can do nothing else", () => {
    // No editing, no deleting, no reordering: the only thing this module can ask
    // the store for is one more line. Two verses on one kigo are two `add`s, in
    // the order they were written, and nothing else ever happens.
    const { kept } = fresh();
    for (const line of ["still true", "harder in winter"]) {
      offerVerse("k_one");
      writeVerse(line);
      confirmVerse();
    }
    expect(kept).toEqual([
      { id: "k_one", verse: "still true" },
      { id: "k_one", verse: "harder in winter" },
    ]);
  });
});

describe("what a verse may be", () => {
  // The slip's rules, because it is the slip's field. A verse is written on the
  // same paper as the season word above it and there is no more of it, so it
  // takes the same cap and the same one-line rule.

  it("is capped at what the wings will hold", () => {
    const { kept } = fresh();
    offerVerse("k_one");
    writeVerse("永".repeat(writingCap() + 40));
    confirmVerse();
    expect([...kept[0].verse].length).toBe(writingCap());
  });

  it("counts the cap in code points, not UTF-16 units", () => {
    // Otherwise the budget is halved for anyone writing in a script that lives
    // outside the basic plane.
    const { kept } = fresh();
    offerVerse("k_one");
    writeVerse("𠮟".repeat(writingCap()));
    confirmVerse();
    expect([...kept[0].verse].length).toBe(writingCap());
  });

  it("is one line, whatever a paste carried in", () => {
    const { kept } = fresh();
    offerVerse("k_one");
    writeVerse("still doing it,\nand dinner\tis longer now");
    confirmVerse();
    expect(kept[0].verse).toBe("still doing it, and dinner is longer now");
  });
});

describe("what the overlay says", () => {
  it("says nothing at all when no pen is out", () => {
    fresh();
    expect(verseStatus()).toBe("verse: —");
  });

  it("never puts the words themselves on the screen", () => {
    // The overlay ends up in screenshots, and this is somebody's diary.
    fresh();
    offerVerse("k_one");
    writeVerse("a private thing");
    const status = verseStatus();
    expect(status).toContain("k_one");
    expect(status).not.toContain("private");
  });
});
