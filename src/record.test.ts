// The recording ceremony's promises.
//
// Most of this step is a picture and can only be judged as one. These are the
// parts that are not, and each of them is a promise that is silent when broken:
//
//   · Cancelling leaves no trace at all. No file, no hole, no id spent.
//   · The line is capped at what the wings can hold, and the cap comes from the
//     wings rather than from a number somebody picked.
//   · A hole is a function of the id, so the same kigo is cut from the same
//     place on the sheet forever.
//   · A kigo recorded today is a folded square and not a butterfly.
//
// Everything runs against the in-memory KigoIO, so the suite has no route to
// anyone's real store even if something in it is wrong.

import { afterEach, describe, expect, it } from "vitest";
import { hasEmerged } from "./kigo-format";
import { createMemoryIO, type MemoryIO } from "./kigo-io";
import { createStore, KIGO_DIR, type KigoStore } from "./store";
import { clearHoles, holeAt, holeCount, HOLES } from "./holes";
import { chrysalisSlot, setChrysalides } from "./chrysalis";
import { SCISSORS, resetScissors, scissorsHit } from "./scissors";
import {
  RECORD,
  cancelSlip,
  confirmSlip,
  cyclePaper,
  initRecord,
  isRecording,
  lineBudget,
  openSlip,
  recordClaimsPointer,
  recordLine,
  recordPhase,
  resetRecord,
  stepRecord,
  writeLine,
} from "./record";
import { sheetRect } from "./paper";

const TODAY = "2026-08-02";
const SHEET = sheetRect(420, 300);

function fresh(): { io: MemoryIO; store: KigoStore; created: string[] } {
  const io = createMemoryIO();
  let n = 0;
  const store = createStore(io, { newId: () => `k_${String(++n).padStart(6, "0")}` });
  const created: string[] = [];
  initRecord({
    create: (draft) => store.create(draft),
    today: () => TODAY,
    onCreated: (kigo) => {
      created.push(kigo.id);
      setChrysalides([{ id: kigo.id, category: kigo.category }]);
    },
  });
  return { io, store, created };
}

// dt = 0 advances nothing, which is what most of these want: the state machine
// without the animation. `run` is for the few that need the ceremony to finish.
const settle = () => stepRecord(0, null, SHEET);
const run = (seconds: number) => {
  for (let i = 0, n = Math.round(seconds * 60); i < n; i++) stepRecord(1 / 60, null, SHEET);
};

// The write is a promise, so the phase after a confirm arrives a microtask
// later however fast the disk is.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  resetRecord();
  clearHoles();
  setChrysalides([]);
  resetScissors();
});

describe("the scissors", () => {
  it("lie on the sheet, where they can be clicked", () => {
    const at = {
      x: SHEET.x + SHEET.w * SCISSORS.atX,
      y: SHEET.y + SHEET.h * SCISSORS.atY,
    };
    expect(scissorsHit(at.x, at.y, SHEET)).toBe(true);
    expect(scissorsHit(SHEET.x + SHEET.w / 2, SHEET.y + 4, SHEET)).toBe(false);
  });

  it("claim the pointer where they are, and nowhere else", () => {
    // The rule the whole gesture rests on: resting the cursor on the scissors
    // summons no butterfly, because these two gestures share a pointer and both
    // are "hold still here".
    const at = {
      x: SHEET.x + SHEET.w * SCISSORS.atX,
      y: SHEET.y + SHEET.h * SCISSORS.atY,
    };
    expect(recordClaimsPointer(at.x, at.y, SHEET)).toBe(true);
    expect(recordClaimsPointer(SHEET.x + SHEET.w / 2, SHEET.y + 10, SHEET)).toBe(false);
  });

  it("claim the whole sheet once a slip is open", () => {
    fresh();
    openSlip();
    expect(recordClaimsPointer(SHEET.x + SHEET.w / 2, SHEET.y + 10, SHEET)).toBe(true);
  });
});

describe("writing the line", () => {
  it("holds the entry CLAUDE.md was designed around", () => {
    // Without a canvas the cap falls back to a nominal em per character, which
    // is the same conservative assumption the measured one makes. It has to be
    // derived rather than picked, or it can quietly drift below what the wings
    // really hold — and the first thing to fall off the end would be this.
    expect(lineBudget()).toBeGreaterThanOrEqual(
      [..."leaving my phone in the kitchen at dinner"].length,
    );
  });

  it("keeps it to one line, whatever is pasted in", () => {
    fresh();
    openSlip();
    writeLine("leaving my phone\nin the kitchen\tat dinner");
    expect(recordLine()).toBe("leaving my phone in the kitchen at dinner");
    expect(recordLine()).not.toContain("\n");
  });

  it("caps it at what the wings will hold", () => {
    // Not at a number somebody picked: the medium enforces the brevity, so a
    // kigo can never be recorded that its own butterfly could not show you.
    fresh();
    openSlip();
    writeLine("永".repeat(lineBudget() + 40));
    expect([...recordLine()].length).toBe(lineBudget());
  });

  it("counts the cap in characters, not in code units", () => {
    // A budget counted in UTF-16 units would be halved for anyone writing in a
    // script that lives outside the basic plane, which is a strange thing to do
    // to a Japanese form.
    fresh();
    openSlip();
    writeLine("𠮟".repeat(lineBudget()));
    expect([...recordLine()].length).toBe(lineBudget());
  });
});

describe("cancelling", () => {
  it("leaves no file, no hole, and no id spent", async () => {
    // The whole promise of Escape. The id is minted on confirm and not when the
    // slip appears, because an id is the one thing in this app that can never
    // be taken back — a butterfly's entire appearance derives from it — and
    // spending one on a slip somebody thought better of would quietly burn a
    // creature nobody ever saw.
    const { io, store } = fresh();
    openSlip();
    writeLine("leaving my phone in the kitchen at dinner");
    cyclePaper(1);
    cancelSlip();
    run(1);
    await flush();

    expect(recordPhase()).toBe("idle");
    expect([...io.files.keys()]).toEqual([]);
    expect(holeCount()).toBe(0);
    expect((await store.all()).length).toBe(0);
  });

  it("forgets the words, so the next slip is blank", () => {
    fresh();
    openSlip();
    writeLine("a thing I thought better of");
    cancelSlip();
    run(1);
    openSlip();
    expect(recordLine()).toBe("");
  });

  it("cannot take Enter back while the disk is still thinking", async () => {
    // The race that would otherwise produce a file with no butterfly. Once the
    // write is away there is no answer an Escape could give that is not wrong,
    // so it is not offered one.
    let land = (_: { id: string }) => {};
    const created: string[] = [];
    initRecord({
      create: () => new Promise((resolve) => (land = resolve)),
      today: () => TODAY,
      onCreated: (kigo) => created.push(kigo.id),
    });
    openSlip();
    writeLine("watering the balcony pots");

    confirmSlip();
    expect(recordPhase()).toBe("sealing");
    cancelSlip();
    expect(recordPhase(), "Escape unpicked a write that was already away").toBe("sealing");

    land({ id: "k_00beef" });
    await flush();
    expect(created).toEqual(["k_00beef"]);
    expect(recordPhase()).toBe("cutting");
  });

  it("keeps a kigo that landed after the view was torn down", async () => {
    // A mode change mid-write. The ceremony is lost, which does not matter; the
    // entry is on disk, which does, so it is reported either way and turns up
    // as a folded square rather than as a file nobody knows about.
    let land = (_: { id: string }) => {};
    const created: string[] = [];
    initRecord({
      create: () => new Promise((resolve) => (land = resolve)),
      today: () => TODAY,
      onCreated: (kigo) => created.push(kigo.id),
    });
    openSlip();
    writeLine("watering the balcony pots");
    confirmSlip();

    resetRecord(); // the gallery opened, the window resized, the sheet moved
    land({ id: "k_00cafe" });
    await flush();
    expect(created).toEqual(["k_00cafe"]);
    expect(recordPhase()).toBe("idle");
  });

  it("has nothing to cancel once the cut has started", async () => {
    const { io } = fresh();
    openSlip();
    writeLine("watering the balcony pots");
    confirmSlip();
    await flush();
    expect(recordPhase()).toBe("cutting");

    cancelSlip();
    settle();
    expect(recordPhase()).toBe("cutting");
    expect([...io.files.keys()].some((p) => p.startsWith(KIGO_DIR))).toBe(true);
  });
});

describe("confirming", () => {
  it("writes the entry, then cuts the sheet, then folds the slip", async () => {
    // The order is the ceremony, and it is the order because the writing is
    // what makes the entry real and everything after it is only what that looks
    // like. A cut before a successful write would be a hole in the sheet with
    // nothing on disk to account for it.
    const { io, store, created } = fresh();
    openSlip();
    writeLine("leaving my phone in the kitchen at dinner");
    confirmSlip();

    expect(recordPhase(), "it cut before the disk answered").toBe("sealing");
    expect(holeCount()).toBe(0);

    await flush();
    expect(created.length).toBe(1);
    expect(holeCount()).toBe(1);
    expect(recordPhase()).toBe("cutting");

    const kigo = await store.all();
    expect(kigo.length).toBe(1);
    expect(kigo[0].text).toBe("leaving my phone in the kitchen at dinner");
    expect(kigo[0].created).toBe(TODAY);
    expect(io.files.has(`${KIGO_DIR}/${TODAY}-leaving-my-phone-in-the-kitchen-at-dinner.md`)).toBe(
      true,
    );

    run(HOLES.cutSec + RECORD.foldSec + RECORD.settleSec + 0.5);
    expect(recordPhase()).toBe("idle");
  });

  it("files an undyed slip under muki", async () => {
    // A blank slip is a piece of the back sheet, and `muki` is the undyed stock
    // — "for what has no season". Confirming without choosing is not an error
    // and does not need to be caught.
    const { store } = fresh();
    openSlip();
    writeLine("a one-time thing");
    confirmSlip();
    await flush();
    expect((await store.all())[0].category).toBe("muki");
  });

  it("files it under the paper that was chosen", async () => {
    const { store } = fresh();
    openSlip();
    writeLine("watering the balcony pots before the heat");
    cyclePaper(1); // off the end of nothing, onto the first stock
    confirmSlip();
    await flush();
    expect((await store.all())[0].category).toBe("season");
  });

  it("does nothing at all on an empty slip", async () => {
    // Enter on a blank slip is a keystroke, not a decision. Escape is how you
    // leave, and this must not become a second way to do it.
    const { io } = fresh();
    openSlip();
    confirmSlip();
    await flush();
    expect(isRecording()).toBe(true);
    expect([...io.files.keys()]).toEqual([]);
  });

  it("leaves the words on the slip when the disk refuses", async () => {
    // No badge, no alert, no dialogue — CLAUDE.md forbids all three outright.
    // The only honest thing a failed write can look like is a slip that is
    // still open with the line still in it.
    const io = createMemoryIO();
    const store = createStore(io);
    initRecord({
      create: () => Promise.reject(new Error("the disk is full")),
      today: () => TODAY,
      onCreated: () => {},
    });
    openSlip();
    writeLine("still worth writing down");
    confirmSlip();
    await flush();

    expect(recordPhase()).toBe("writing");
    expect(recordLine()).toBe("still worth writing down");
    expect(holeCount()).toBe(0);
    expect((await store.all()).length).toBe(0);
    expect([...io.files.keys()]).toEqual([]);
  });
});

describe("the hole it leaves", () => {
  it("is a function of the id and nothing else", () => {
    // Nothing about a hole is persisted, and nothing needs to be. That is what
    // makes step 13 — every past entry's hole, and the poster that comes from
    // them — an addition rather than a migration.
    const a = holeAt("k_7f3a9c", SHEET);
    const b = holeAt("k_7f3a9c", SHEET);
    expect(a).toEqual(b);
    expect(holeAt("k_0b41de", SHEET)).not.toEqual(a);
  });

  it("falls inside the sheet, clear of the floor of the box", () => {
    for (const id of ["k_7f3a9c", "k_0b41de", "k_c25a08", "k_913fb7", "k_ff0192"]) {
      const at = holeAt(id, SHEET);
      expect(at.x).toBeGreaterThan(SHEET.x);
      expect(at.x).toBeLessThan(SHEET.x + SHEET.w);
      expect(at.y).toBeGreaterThan(SHEET.y);
      // clear of the bottom, where the scissors lie and the squares accumulate
      expect(at.y).toBeLessThan(SHEET.y + SHEET.h * (1 - HOLES.marginBottom) + at.scale);
    }
  });

  it("moves with the sheet rather than with the window", () => {
    // The same kigo on a bigger window is in the same *place on the paper*,
    // which is the thing that gets printed.
    const big = sheetRect(840, 600);
    const small = holeAt("k_7f3a9c", SHEET);
    const large = holeAt("k_7f3a9c", big);
    const u = (at: { x: number }, s: typeof SHEET) => (at.x - s.x) / s.w;
    expect(u(large, big)).toBeCloseTo(u(small, SHEET), 6);
  });
});

describe("what it settles into", () => {
  it("is a folded square and not a butterfly", () => {
    // Emergence. A kigo recorded today has not come out yet, and it will not
    // until the widget is next opened on a later day — the one thing in the app
    // that ever asks the user to return, and it asks by promising.
    expect(hasEmerged({ created: TODAY }, TODAY)).toBe(false);
    expect(hasEmerged({ created: TODAY }, "2026-08-03")).toBe(true);
  });

  it("has a slot at the bottom of the box, so the fold knows where to land", async () => {
    const { created } = fresh();
    openSlip();
    writeLine("leaving my phone in the kitchen at dinner");
    confirmSlip();
    await flush();

    const slot = chrysalisSlot(created[0], SHEET);
    expect(slot).not.toBeNull();
    expect(slot!.y).toBeGreaterThan(SHEET.y + SHEET.h * 0.7);
    expect(slot!.x).toBeGreaterThan(SHEET.x);
    expect(slot!.x + slot!.size).toBeLessThan(SHEET.x + SHEET.w);
  });
});
