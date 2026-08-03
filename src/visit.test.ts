// Coming to the cursor, and choosing who comes.
//
// Judged by eye, mostly — but not these. The dwell is what keeps a swept cursor
// from summoning a parade; the ladder of scales is what keeps the approach out
// of the tile cache; and coming forward must never be mistaken for being
// younger. Each of those fails in a way that looks like the motion needing more
// tuning, which is why they are pinned here rather than looked at.
//
// A visit needs a swarm to pick from, so these run against flight.ts's own
// flyers. That is the honest shape of it: this module is the state machine and
// flight is the population, and the seam between them is exactly `stepFlight`
// handing over a butterfly.

import { afterEach, describe, expect, it } from "vitest";
import {
  flightBounds,
  flyerCount,
  setSwarm,
  stepFlight,
  swarmDepth,
  type SwarmEntry,
} from "./flight";
import { planeTable } from "./planes";
import { endVerse, initVerse, offerVerse, verseOfferedTo } from "./verse";
import {
  VISIT,
  beginBloom,
  clearCursor,
  endVisit,
  hitTest,
  nearest,
  registerPointerClaim,
  setCursor,
  visitReport,
} from "./visit";
import { WING_TEXT } from "./wing-text";

const TODAY = "2026-07-27";

const entry = (id: string, created: string, since = created, touches = 0): SwarmEntry => ({
  id,
  category: "humanity",
  created,
  since,
  touches,
});

// Nothing else on the sheet owns the pointer unless a test says so.
afterEach(() => registerPointerClaim(() => false));

describe("choosing who comes", () => {
  // The whole of the choice, and the only part of a visit that can be got wrong
  // quietly: a rule that reached past the front of the box for something on the
  // back wall would look like the widget ignoring the pointer.
  const at = (id: string, x: number, y: number, plane: number) => ({ id, x, y, plane });

  it("has nobody to send when the box is empty", () => {
    expect(nearest([], 100, 100)).toBeNull();
  });

  it("sends the nearest in screen space, whatever plane it is on", () => {
    const far = at("k_far", 102, 100, 4);
    const near = at("k_near", 160, 100, 0);
    expect(nearest([near, far], 100, 100)).toBe(far);
    expect(nearest([far, near], 100, 100)).toBe(far);
  });

  it("gives a tie to the front plane, whichever order they arrive in", () => {
    // Equally close, so the one being *looked at* wins: it is bigger, sharper
    // and in front of the other.
    const front = at("k_front", 140, 100, 0);
    const back = at("k_back", 60, 100, 3);
    expect(nearest([back, front], 100, 100)).toBe(front);
    expect(nearest([front, back], 100, 100)).toBe(front);
  });
});

describe("coming to the cursor", () => {
  const bounds = flightBounds(420, 300);
  const MIDDLE = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
  const V = VISIT;

  let clock = 0;
  const fly = (seconds: number) => {
    for (let i = 0, n = Math.max(1, Math.round(seconds * 60)); i < n; i++) {
      clock += 1 / 60;
      stepFlight(1 / 60, clock, bounds);
    }
  };

  // Put one kigo in the box, with nobody left over from the test before —
  // emptying the swarm first, because a flyer that keeps its place across a
  // `setSwarm` also keeps the plane it was already on.
  const alone = (created = TODAY): void => {
    endVisit();
    fly(2);
    setSwarm([], TODAY);
    fly(1 / 60);
    setSwarm([{ ...entry("k_visit1", created), text: "leaving my phone in the kitchen" }], TODAY);
    fly(0.1);
  };

  const rest = (at: { x: number; y: number }, seconds: number) => {
    setCursor(at.x, at.y);
    fly(seconds);
  };

  // Keep the pointer moving, so no dwell ever matures and nobody new is asked
  // for. A resting cursor would summon again the moment the last one got home,
  // which is correct and is exactly what these particular tests must avoid.
  const sweep = (from: { x: number; y: number }, seconds: number) => {
    for (let i = 0, n = Math.round(seconds * 60); i < n; i++) {
      setCursor(from.x + (i % 30), from.y);
      clock += 1 / 60;
      stepFlight(1 / 60, clock, bounds);
    }
  };

  it("is not summoned by a cursor passing through", () => {
    // The rule the whole gesture rests on. The box is small and the pointer
    // crosses it all day on its way somewhere else; a hover would peel a
    // creature off the swarm every time someone reached for the taskbar.
    alone();
    for (let i = 0; i < 120; i++) {
      setCursor(bounds.x + 4 + i * 2, MIDDLE.y);
      clock += 1 / 60;
      stepFlight(1 / 60, clock, bounds);
    }
    expect(visitReport()).toBeNull();
  });

  it("is summoned by a cursor that comes to rest", () => {
    alone();
    rest(MIDDLE, V.dwellSec / 2);
    expect(visitReport(), "it came before the dwell was up").toBeNull();
    rest(MIDDLE, V.dwellSec);
    expect(visitReport()?.id).toBe("k_visit1");
  });

  it("lands, opens, and grows well past the plane it came from", () => {
    // "Coming to you means coming nearer", and nearer is bigger — the same
    // perspective the planes already use. It has to end up large enough to
    // read a line off, which is most of the width of the sheet.
    alone();
    rest(MIDDLE, 4);
    const visit = visitReport()!;
    expect(visit.phase).toBe("alighted");
    expect(visit.u).toBeGreaterThan(0.98);
    expect(visit.scale).toBeGreaterThan(planeTable()[0].scale * 3);
    expect(visit.scale).toBe(WING_TEXT.span);
  });

  it("walks a short ladder of wingspans rather than a continuum", () => {
    // The claim the tile cache rests on, and the same bargain depth planes
    // strike: `scale` is part of the cache key, so an approach that eased its
    // size smoothly would mint a fresh sprite sheet on every frame of it.
    alone();
    setCursor(MIDDLE.x, MIDDLE.y);
    const scales = new Set<number>();
    for (let i = 0; i < 60 * 4; i++) {
      clock += 1 / 60;
      stepFlight(1 / 60, clock, bounds);
      const visit = visitReport();
      if (visit) scales.add(visit.scale);
    }
    expect(scales.size).toBeGreaterThan(1); // it did travel
    expect(scales.size).toBeLessThanOrEqual(Math.round(V.steps) + 1);
    // and each is what the cache key will read, not a value it rounds off
    for (const s of scales) expect(s).toBe(Number(s.toFixed(2)));
  });

  it("goes home when the cursor moves away, and rejoins its plane", () => {
    alone();
    rest(MIDDLE, 4);
    expect(visitReport()?.phase).toBe("alighted");

    setCursor(MIDDLE.x + V.leavePx * 2, MIDDLE.y);
    fly(1 / 60);
    expect(visitReport()?.phase, "it stayed").toBe("leaving");

    sweep({ x: MIDDLE.x + V.leavePx * 2, y: MIDDLE.y }, 4);
    expect(visitReport(), "it never got home").toBeNull();
    expect(flyerCount()).toBe(1);
  });

  it("goes home when the cursor leaves the sheet", () => {
    // No timeout and no dismissing it. Leaving is only ever moving away.
    alone();
    rest(MIDDLE, 4);
    clearCursor();
    fly(4);
    expect(visitReport()).toBeNull();
  });

  it("never sends a second while the first is still on its way home", () => {
    // Only ever one at a time, and the gap between one leaving and the next
    // being asked for is where a second could slip in.
    alone();
    rest(MIDDLE, 4);
    const first = visitReport()!.id;

    rest({ x: MIDDLE.x + V.leavePx * 3, y: MIDDLE.y }, V.dwellSec * 1.5);
    const during = visitReport();
    expect(during?.id).toBe(first);
    expect(during?.phase).toBe("leaving");
  });

  it("never moves a butterfly in depth by coming forward", () => {
    // Depth is age. Coming to the cursor is not being younger, and a butterfly
    // that had quietly changed plane on the way back would be a kigo that
    // rewrote its own created date by being looked at.
    alone("2019-05-01"); // long ago: the back wall
    const before = swarmDepth();
    expect(before[before.length - 1]).toBe(1);

    rest(MIDDLE, 4);
    expect(visitReport()?.phase).toBe("alighted");
    expect(swarmDepth(), "it changed plane on the way out").toEqual(before);

    clearCursor();
    fly(4);
    expect(swarmDepth(), "it changed plane on the way back").toEqual(before);
  });

  it("claims a press only on the one that has landed", () => {
    // CLAUDE.md: dragging must never swallow a touch, and the whole surface is
    // draggable. So exactly one creature ever claims a press — any more and a
    // third of the window becomes dead space where the widget cannot be moved.
    alone();
    expect(hitTest(MIDDLE.x, MIDDLE.y), "it claimed a press with nobody landed").toBe(false);

    rest(MIDDLE, 4);
    expect(hitTest(MIDDLE.x, MIDDLE.y)).toBe(true);
    expect(hitTest(bounds.x + 1, bounds.y + 1)).toBe(false);

    clearCursor();
    fly(4);
    expect(hitTest(MIDDLE.x, MIDDLE.y), "it kept claiming after it left").toBe(false);
  });
});

describe("what else is on the sheet", () => {
  // The scissors and the summons are the same gesture — hold the pointer still
  // — and they share one pointer. The ambiguity is resolved by place: where
  // something else has claimed the pointer, no dwell matures there, so resting
  // on the scissors and clicking them can never also have called a butterfly
  // onto them.
  const bounds = flightBounds(420, 300);
  const MIDDLE = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };

  let clock = 0;
  const fly = (seconds: number) => {
    for (let i = 0, n = Math.max(1, Math.round(seconds * 60)); i < n; i++) {
      clock += 1 / 60;
      stepFlight(1 / 60, clock, bounds);
    }
  };

  const alone = (): void => {
    endVisit();
    fly(2);
    setSwarm([], TODAY);
    fly(1 / 60);
    setSwarm([entry("k_visit2", TODAY)], TODAY);
    fly(0.1);
  };

  it("summons nobody where something else has claimed the pointer", () => {
    alone();
    registerPointerClaim((x, y) => Math.hypot(x - MIDDLE.x, y - MIDDLE.y) < 24);
    setCursor(MIDDLE.x, MIDDLE.y);
    fly(4);
    expect(visitReport(), "the scissors did not win").toBeNull();
  });

  it("goes on summoning everywhere else", () => {
    alone();
    registerPointerClaim((x, y) => Math.hypot(x - MIDDLE.x, y - MIDDLE.y) < 24);
    setCursor(MIDDLE.x + 60, MIDDLE.y);
    fly(4);
    expect(visitReport()?.id).toBe("k_visit2");
  });

  it("sends a landed one home if the pointer wanders onto it", () => {
    alone();
    setCursor(MIDDLE.x, MIDDLE.y);
    fly(4);
    expect(visitReport()?.phase).toBe("alighted");

    registerPointerClaim(() => true);
    fly(1 / 60);
    expect(visitReport()?.phase).toBe("leaving");
  });
});

describe("the bloom", () => {
  // What it looks like is judged by eye and cannot be judged any other way.
  // These are the parts that are simply true or false, and each of them fails
  // silently: a bloom that never starts, one that starts on the wrong creature,
  // and one that runs off a clock of its own.
  const bounds = flightBounds(420, 300);
  const MIDDLE = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };

  let clock = 0;
  const fly = (seconds: number) => {
    for (let i = 0, n = Math.max(1, Math.round(seconds * 60)); i < n; i++) {
      clock += 1 / 60;
      stepFlight(1 / 60, clock, bounds);
    }
  };

  // One kigo, four seasons stale and much handled, landed and open.
  const landed = (): void => {
    endVisit();
    fly(2);
    setSwarm([], TODAY);
    fly(1 / 60);
    setSwarm([entry("k_bloom", "2024-02-11", "2024-02-11", 9)], TODAY);
    fly(0.1);
    setCursor(MIDDLE.x, MIDDLE.y);
    fly(4);
    expect(visitReport()?.phase, "it never landed").toBe("alighted");
  };

  it("does nothing at all until something is touched", () => {
    landed();
    expect(visitReport()?.bloom).toBe(1);
  });

  it("starts at the fold and reaches the wingtips inside its own second", () => {
    landed();
    beginBloom("k_bloom");
    expect(visitReport()?.bloom).toBe(0);
    fly(VISIT.bloomSec / 2);
    const half = visitReport()!.bloom;
    expect(half).toBeGreaterThan(0.2);
    expect(half).toBeLessThan(1);
    fly(VISIT.bloomSec);
    expect(visitReport()?.bloom).toBe(1);
  });

  it("ignores a touch on anyone but the one standing on the cursor", () => {
    // A touch can only ever be made on a landed butterfly, but the bloom is
    // driven by an id rather than by the visit, so this is the one place the two
    // could disagree.
    landed();
    beginBloom("k_somebody_else");
    fly(0.1);
    expect(visitReport()?.bloom).toBe(1);
  });

  it("runs off the frame clock, so a throttled widget still finishes it", () => {
    // Nothing in this module reads a clock of its own. At the unfocused cadence
    // two thirds of a second is seven frames rather than forty, and the bloom
    // has to be over in the same two thirds of a second either way — a bloom on
    // a timer would finish while the widget was hidden and be gone before
    // anyone looked.
    landed();
    beginBloom("k_bloom");
    for (let i = 0, n = Math.ceil(VISIT.bloomSec * 10); i < n; i++) {
      clock += 1 / 10;
      stepFlight(1 / 10, clock, bounds);
    }
    expect(visitReport()?.bloom).toBe(1);
  });

  it("is over when the butterfly goes home", () => {
    landed();
    beginBloom("k_bloom");
    fly(0.1);
    expect(visitReport()!.bloom).toBeLessThan(1);
    endVisit();
    fly(3);
    // and the next one to land does not inherit it
    setCursor(MIDDLE.x, MIDDLE.y);
    fly(4);
    expect(visitReport()?.bloom).toBe(1);
  });
});

describe("the line a touch opens", () => {
  // What a verse *is* belongs to verse.ts and wing-text.ts, and is pinned there.
  // This is the seam: an offer stands exactly as long as the creature it was made
  // on, and letting go of one must cost the touch nothing.
  const bounds = flightBounds(420, 300);
  const MIDDLE = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };

  let clock = 0;
  const fly = (seconds: number) => {
    for (let i = 0, n = Math.max(1, Math.round(seconds * 60)); i < n; i++) {
      clock += 1 / 60;
      stepFlight(1 / 60, clock, bounds);
    }
  };

  const landed = (): void => {
    endVisit();
    fly(2);
    setSwarm([], TODAY);
    fly(1 / 60);
    setSwarm([{ ...entry("k_pen", TODAY), text: "leaving my phone in the kitchen" }], TODAY);
    fly(0.1);
    setCursor(MIDDLE.x, MIDDLE.y);
    fly(4);
    expect(visitReport()?.phase, "it never landed").toBe("alighted");
    initVerse({ add: () => {} });
  };

  afterEach(() => endVerse());

  it("takes the pen away when the cursor moves off", () => {
    // "Press Escape, or move away, and the touch stands alone with nothing
    // written." Nothing here writes anything — the touch is already on disk by
    // the time a line opens — so this only has to let go.
    landed();
    offerVerse("k_pen");
    expect(verseOfferedTo()).toBe("k_pen");

    setCursor(MIDDLE.x + VISIT.leaveHeldPx * 2, MIDDLE.y);
    fly(1 / 60);
    expect(verseOfferedTo(), "it kept the pen out after leaving").toBeNull();
  });

  it("takes it away when the cursor leaves the sheet entirely", () => {
    landed();
    offerVerse("k_pen");
    clearCursor();
    fly(1 / 60);
    expect(verseOfferedTo()).toBeNull();
  });

  it("does not let a knock against the mouse throw away a sentence", () => {
    // A butterfly being read is being looked at, and a small radius is right for
    // that: move the eye and it goes. One being written on is being held, and the
    // pointer is not doing anything at all. The rule that moving away ends it is
    // untouched; only what counts as away moves.
    landed();
    const nudge = (VISIT.leavePx + VISIT.leaveHeldPx) / 2;
    offerVerse("k_pen");
    setCursor(MIDDLE.x + nudge, MIDDLE.y);
    fly(1 / 60);
    expect(visitReport()?.phase, "a nudge sent it home mid-sentence").toBe("alighted");
    expect(verseOfferedTo()).toBe("k_pen");

    // ...and the same nudge with no pen out does send it home
    endVerse();
    setCursor(MIDDLE.x, MIDDLE.y);
    fly(2);
    setCursor(MIDDLE.x + nudge, MIDDLE.y);
    fly(1 / 60);
    expect(visitReport()?.phase).toBe("leaving");
  });

  it("still lets a press land while a verse is being written", () => {
    // The click that takes the focus back has to reach the creature, and by then
    // the pointer may be most of the held radius away from where it landed.
    landed();
    offerVerse("k_pen");
    const nudge = (VISIT.leavePx + VISIT.leaveHeldPx) / 2;
    expect(hitTest(MIDDLE.x + nudge, MIDDLE.y)).toBe(true);
  });
});
