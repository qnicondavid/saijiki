/// <reference types="vite/client" />

import "./style.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { CheckMenuItem, Menu } from "@tauri-apps/api/menu";
import { startRenderLoop } from "./render-loop";
import { registerDragHitTest, setupDragging } from "./input";
import { drawScene, sheetRect } from "./paper";
import { isScrubbed, onClockChange, setAnchor, startClockTicker, today } from "./clock";
import { readDevFlags } from "./dev-flags";
import { installDevHarness, type DevHarness } from "./dev-harness";
import { lastOpen, rememberOpen } from "./last-open";
import { createTauriIO } from "./kigo-io-tauri";
import { createStore } from "./store";
import {
  cut,
  divide,
  fadeOf,
  freshnessOf,
  newlyEmerged,
  toEntry,
  toSaijiki,
  type Entry,
} from "./saijiki";
import { drawChrysalides, setChrysalides } from "./chrysalis";
import { drawHoles, setHoles, stepHoles } from "./holes";
import { clearHatching, drawEmergence, hatch, isHatching, stepEmergence } from "./emergence";
import {
  cancelSlip,
  drawRecordFloor,
  drawRecordFront,
  initRecord,
  isRecording,
  measureBudget,
  recordClaimsPointer,
  recordClaimsPress,
  recordClick,
  recordHover,
  resetRecord,
  stepRecord,
} from "./record";
import { drawFlight, flightBounds, initFlight, setSwarm, stepFlight } from "./flight";
import {
  alightedId,
  clearCursor,
  endVisit,
  hitTest,
  registerPointerClaim,
  setCursor,
} from "./visit";

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const ctx = canvas.getContext("2d")!;

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const { innerWidth: w, innerHeight: h } = window;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener("resize", resize);
resize();

const appWindow = getCurrentWindow();

initFlight();

// --- the dev harness -------------------------------------------------------
//
// The gallery, the tuning panel, the time scrubber, the paper cycler and the F9
// overlay, all of which are development tools and none of which belongs under a
// shipped copy's keyboard. `import.meta.env.DEV` is the literal `false` in a
// built bundle, so this branch — and, once nothing references it, the whole of
// dev-harness.ts and the five modules only it imports — is gone before the
// bundle is written. See the note at the top of that file.
//
// `dev` is therefore always null in a release build, and every use of it below
// is optional-chained. The quit menu is not in here: that is the app's, not the
// harness's.

let dev: DevHarness | null = null;

if (import.meta.env.DEV) {
  dev = installDevHarness({
    window: appWindow,
    storeLabel: () => storeLabel,
    // A dev view is about to take the window, so wherever the pointer was is
    // not where it will be. Anyone at the cursor goes home and the next move
    // re-arms the dwell — and a slip half written is put away rather than left
    // hanging over a sheet that is about to be a different size.
    //
    // A birth in progress is finished rather than restarted: whoever was
    // unfolding joins the swarm as an ordinary butterfly. Nothing is lost — the
    // ceremony was the only thing that was going to happen, and it is not owed
    // twice.
    settle: () => {
      endVisit();
      resetRecord();
      clearHatching();
      applySaijiki();
      showPointer(true);
    },
  });
}

// The hand the wings are written in is the machine's, so how much of it fits on
// them is a question only a canvas can answer. Asked once, here, and the answer
// is the cap on a new entry — see wingTextBudget.
measureBudget(ctx);

// --- the saijiki -----------------------------------------------------------
//
// One butterfly per kigo, and none at all when there are none: an empty store
// is the pristine sheet from step 2, which has to be lovely on its own because
// it is the first several months of real use.
//
// The store is read once at start and the swarm is rebuilt whenever the clock
// moves. `scan` rather than `index`, deliberately: the cache is a lookup hint
// and is only checked for the *set* of files, so a file hand-edited in Notepad —
// which the format is a promise about — would not be noticed until something
// else changed. A few dozen files is what a real saijiki holds, and even a
// hundred and fifty is one burst of reads at startup and never again.

const store = createStore(createTauriIO());

let saijiki: Entry[] = [];
let storeLabel = "store: loading";
let storeName = "real";

async function loadSaijiki(): Promise<void> {
  const { entries, problems } = await store.scan();
  saijiki = toSaijiki(entries.map(({ kigo }) => kigo));
  if (problems.length > 0) {
    // Reported, never fatal: one hand-edited typo must not take the diary down
    // with it, and it must not vanish silently either.
    console.warn(`[store] ${problems.length} file(s) would not parse:`, problems);
  }
  dayTurned();
}

// --- the day turning ---------------------------------------------------------
//
// Emergence needs two days, not one: the day it is, and the day the widget was
// last looked at. Everything that was a folded square then and is not one now
// has a birth waiting, and that is the same sentence whether the gap is one
// midnight, a keypress on the scrubber, or a fortnight with the machine shut.
//
// So this is the only place the app's notion of "the day" is allowed to move,
// and it moves in one step: work out who crossed, put them in the queue, write
// the day down, then redraw the world. The order is load-bearing — a hatchling
// has to be asked where its square was lying *before* the row it was lying in
// is rebuilt without it.

let lastDay = "";

function dayTurned(): void {
  const now = today();
  if (now !== lastDay) {
    hatch(
      newlyEmerged(saijiki, lastDay, now).map((entry) => ({
        id: entry.id,
        category: entry.category,
        // A square scrubbed four seasons forward opens as pale as it would
        // have been lying there — the ceremony does not restore anything.
        fade: fadeOf(entry, now),
      })),
    );
    lastDay = now;
  }
  // Every open, not only the ones where the day moved.
  //
  // This sat inside the branch above and the branch is never taken on a first
  // open: nothing is stored, so `lastOpen` falls back to today, so `lastDay` is
  // already today and the day has not "turned". Nothing was written — and so
  // nothing was stored the next morning either, and the morning after that. The
  // date was only ever written by an app that happened to be running at
  // midnight, and a widget that is closed at night could sit there for a year
  // with a folded square that never hatched.
  //
  // Only the real day is remembered. A widget parked in the future for a minute
  // must not come back and think nothing has happened since.
  if (!isScrubbed()) rememberOpen(storeName, now);
  applySaijiki();
}

/**
 * Hand the day's three piles to the three things that draw them.
 *
 * saijiki.ts decides who is in which pile; this decides what each pile is for.
 * The whole of Emergence's bookkeeping is in that division, and it is a
 * function of two dates rather than a stored flag: no new frontmatter, no
 * schema bump, nothing to migrate and nothing that can rot. The time scrubber
 * moves it for free, which is also the only way to watch it.
 */
function applySaijiki(): void {
  const now = today();
  const day = divide(saijiki, now);
  // Those still unfolding are held back from the swarm until they finish, so
  // the creature the ceremony is carrying is not also in the air behind it.
  setSwarm(
    day.flying.filter((entry) => !isHatching(entry.id)),
    now,
  );
  // The one still folding at the front of the box is in this list too — the
  // ceremony needs it here to know which slot it is aiming at — and record.ts
  // keeps it from being drawn twice while it is still in the air.
  setChrysalides(day.folded.map(({ id, category }) => ({ id, category })));
  // Every kigo whose paper has left the sheet, folded ones included: the cut is
  // made when the entry is written, not when the creature comes out of it. And
  // never one that has not been written — scrub back past a kigo and its hole
  // goes with it, because the sheet is a record of what has happened.
  setHoles(cut(saijiki, now).map((entry) => ({ id: entry.id, fresh: freshnessOf(entry, now) })));
}

// --- the touch ---------------------------------------------------------------
//
// The app's only verb, and the only thing in it that writes. Clicking a
// butterfly that has landed on the cursor and opened means *still true*: today
// goes on its touched list, and the fade — which counts seasons from the last
// day it was known to be true — starts again from full colour.
//
// Three things it deliberately is not:
//
//   · It is not hovering. Reading and affirming are different acts; if looking
//     counted as touching then nothing could ever fade and the fade would mean
//     nothing. Coming to the cursor is free. Saying so costs a click.
//   · It is not twice. The store folds a second touch on the same day into the
//     first, and that is where it belongs — every writer gets it, including a
//     hand-edited file.
//   · It is not a change of depth. Depth is `created`, which a touch never
//     moves. The butterfly returns to full colour exactly where it is in the
//     box, which is the whole difference between "still true" and "begun
//     again".

let touching = false;

async function touchKigo(id: string): Promise<void> {
  if (touching) return; // one write at a time; a double click is one touch anyway
  touching = true;
  try {
    const kigo = await store.touch(id, today());
    const at = saijiki.findIndex((e) => e.id === id);
    if (at >= 0) saijiki[at] = toEntry(kigo);
    applySaijiki();
  } catch (error) {
    // Never fatal, and never a warning on the sheet: CLAUDE.md forbids badges
    // and alerts outright. A touch that could not be written is a line in the
    // console and a butterfly that stays the colour it was.
    console.error(`[store] could not touch ${id}.`, error);
  } finally {
    touching = false;
  }
}

// --- recording -------------------------------------------------------------
//
// The other thing in the app that writes, and the only one that *creates*. The
// store layer does the whole of it in one call — mint an id, derive the season,
// pick the paper, write atomically, refresh the cache — so all this has to do
// is hand it the three things a person supplied and put the result in the box.
//
// The entry goes into `saijiki` and the swarm is reapplied immediately, which
// is what makes the folded square appear at the bottom. It does not become a
// butterfly: `hasEmerged` says no until the day turns.

initRecord({
  create: (draft) => store.create(draft),
  today,
  onCreated: (kigo) => {
    // Through the same door as a file read off the disk: an entry is true on
    // the day it is written, so the fade starts counting from there. Not that
    // anyone will see it fade for a season yet.
    saijiki.push(toEntry(kigo));
    applySaijiki();
  },
});

// --- the frame -------------------------------------------------------------

// rAF timestamps only. Motion never reads a clock of its own, so a throttled or
// stopped loop throttles and stops the motion with it.
let lastNow = 0;

function render(now: number): void {
  const dpr = window.devicePixelRatio || 1;
  const { innerWidth: w, innerHeight: h } = window;

  // Clamped, because the gap across a restart (hidden -> visible) or a stall is
  // arbitrarily large and integrating it would fling the swarm into a corner.
  const dt = lastNow === 0 ? 0 : Math.min(0.15, (now - lastNow) / 1000);
  lastNow = now;

  drawScene(ctx, w, h, dpr);

  if (dev?.drawsInsteadOfWidget()) {
    dev.drawView(ctx, w, h, dpr);
  } else {
    // Back to front, and the order is the box's own depth:
    //
    //   the sheet, and whatever has been cut out of it
    //   the floor of the box — the scissors, the folded squares
    //   the swarm, in the air between
    //   a birth, which has left the floor and come forward
    //   the front of the box — the slip, while there is one
    //
    // The holes come first because they are *in* the sheet rather than on it,
    // and everything else in the picture may pass in front of them.
    const sheet = sheetRect(w, h);
    stepHoles(dt);
    drawHoles(ctx, sheet, dpr);

    stepRecord(dt, pointer, sheet);
    drawRecordFloor(ctx, sheet);
    drawChrysalides(ctx, sheet);

    // Two rects: where the swarm flies, and where a butterfly that has come
    // forward to the cursor is allowed to be. The second is the window itself —
    // it has left the box, so it may cross the box's rim, but never the edge of
    // the glass, where it would simply be cut off.
    const bounds = flightBounds(w, h, reservedForPanel(w, h));
    stepFlight(dt, now / 1000, bounds, {
      x: 0,
      y: 0,
      w: Math.max(0, w - reservedForPanel(w, h)),
      h,
      r: 0,
    });
    drawFlight(ctx, dpr);

    // The same bounds the swarm at the glass flies in, because that is where a
    // thing recorded a day ago belongs and where a birth hands its creature
    // over. `applySaijiki` is what puts it in the swarm, a frame after it let go.
    stepEmergence(dt, sheet, bounds, applySaijiki);
    drawEmergence(ctx, sheet, dpr);

    drawRecordFront(ctx, sheet);
    showPointer(alightedId() === null);
  }

  dev?.endFrame();
}

// The arrow, while a butterfly is standing on it, is the loudest thing on the
// screen and it sits squarely over the words. So it goes away for as long as one
// is landed and open: the butterfly *is* the cursor at that moment, it is at the
// pointer's own position, and moving at all brings both back. Nothing is hidden
// that the user needs — there is one thing on the sheet and it is under the hand.
let pointerShown = true;

function showPointer(show: boolean): void {
  if (show === pointerShown) return;
  pointerShown = show;
  canvas.style.cursor = show ? "" : "none";
}

// How much of the sheet a dev view is sitting on. Zero in a shipped copy, where
// there are no dev views — the whole sheet is the swarm's.
function reservedForPanel(cssW: number, cssH: number): number {
  return dev?.reservedWidth(cssW, cssH) ?? 0;
}

startRenderLoop({
  window: appWindow,
  render,
  onStateChange: () => dev?.update(),
});

// --- the pointer -------------------------------------------------------------
//
// The position goes to flight and nothing else happens here. The dwell that
// decides whether anyone has been asked for is measured against the rAF clock
// inside stepFlight, not against a timer of its own — a timer would keep
// running while the widget is hidden and summon a butterfly to a cursor that
// left ten minutes ago.
//
// Mouse events reach an unfocused window, which matters: an always-on-top
// widget is looked at precisely when something else has focus, so this has to
// work without clicking the window first. It does — the click that touches is
// the first thing that takes focus.

// Where the pointer is, for the things that are not the swarm. The scissors
// need it to know when to lift, and they need to know when it has gone away —
// which `null` is for.
let pointer: { x: number; y: number } | null = null;

const currentSheet = () => sheetRect(window.innerWidth, window.innerHeight);

window.addEventListener("mousemove", (e) => {
  pointer = { x: e.clientX, y: e.clientY };
  setCursor(e.clientX, e.clientY);
  recordHover(e.clientX, e.clientY, currentSheet());
});

// On `document`, not `window`: mouseleave does not bubble, so a listener on the
// window is never on the path of an event that leaves the viewport.
document.addEventListener("mouseleave", () => {
  pointer = null;
  clearCursor();
});

// Two gestures, one pointer, and both of them are "hold still here". The
// scissors win where they overlap: no butterfly is ever summoned onto them, and
// while a slip is open nobody is summoned at all. Resolved by *place* rather
// than by timing, because a rule beats a race.
registerPointerClaim((x, y) => recordClaimsPointer(x, y, currentSheet()));

// Dragging asks before it starts. A press on a landed butterfly is claimed
// here, and so is one on the scissors, the slip or a swatch; a press on bare
// paper still moves the window, so the widget stays draggable from anywhere
// except the few things that are actually objects.
registerDragHitTest((x, y) => hitTest(x, y) || recordClaimsPress(x, y, currentSheet()));

setupDragging(appWindow);

// The click. Three things can want it, and they are asked in the order they sit
// in the box, front first. `hitTest` is asked again rather than trusting the
// press, because between the two the butterfly may have been sent home by a
// movement — and a touch is a deliberate act, not a thing that lands on
// whatever was there.
window.addEventListener("click", (e) => {
  if (e.button !== 0) return;
  if (recordClick(e.clientX, e.clientY, currentSheet())) return;
  const id = alightedId();
  if (id && hitTest(e.clientX, e.clientY)) touchKigo(id);
});

// --- starting up ------------------------------------------------------------
//
// Not awaited before the first frame. The empty state is a complete picture, so
// the sheet is drawn immediately and the butterflies arrive when the disk has
// finished answering — which is the right way round, because the alternative is
// a blank window for however long the read takes.

async function start(): Promise<void> {
  const flags = await readDevFlags();

  // `npm run icon`. The app draws its own icon and leaves, instead of being a
  // widget — see src/icon-forge.ts and scripts/icon.mjs. The flag is only ever
  // true in a debug build, and the import is behind the same gate as the rest
  // of the harness, so none of it is in the shipped bundle.
  if (import.meta.env.DEV && flags.icon) {
    const { forgeIcons } = await import("./icon-forge");
    try {
      await forgeIcons();
    } catch (error) {
      console.error("[icon] could not draw the icon set.", error);
    }
    await invoke("quit");
    return;
  }

  if (flags.today) {
    try {
      setAnchor(flags.today);
    } catch (error) {
      console.error(`[dev] --today=${flags.today} is not a date I can read.`, error);
    }
  }
  storeName = flags.store === "dev" ? "dev" : "real";
  storeLabel = `store: ${flags.store === "dev" ? "saijiki-dev (synthetic)" : "saijiki"}`;

  // Where the day was when the widget was last looked at. Anyone who has
  // stopped being a folded square since then has a birth waiting, however long
  // ago that was. Today when there is no answer, which means nothing hatches —
  // see last-open.ts on why that is the right way to fail.
  lastDay = lastOpen(storeName, today());

  // Every time the day moves — a scrub, or midnight — whoever crossed is put in
  // the queue, the fade is recomputed and the swarm is recoloured in place.
  onClockChange(dayTurned);
  startClockTicker();

  try {
    await loadSaijiki();
  } catch (error) {
    console.error("[store] could not read the saijiki; showing the empty sheet.", error);
    storeLabel += " · unreadable";
  }
  dev?.update();
}

start();

// --- the keyboard ----------------------------------------------------------
//
// A shipped copy has one key, and it is Escape. Everything else that this app
// has ever answered to — the gallery, the tuning panel, the time scrubber, the
// paper cycler, the F9 overlay — is a development tool and is handed to the dev
// harness, which is not there in a release build.

window.addEventListener("keydown", (e) => {
  // Escape puts the slip away wherever the focus happens to be. The input's own
  // handler catches this first when it has focus, which is nearly always; this
  // is for the case where a click somewhere else took the focus with it, and a
  // slip you cannot cancel would be the app holding someone hostage.
  if (e.key === "Escape" && isRecording()) {
    cancelSlip();
    return;
  }

  // the panel has forty number inputs in it; typing a value into one must not
  // also be a shortcut
  const target = e.target as HTMLElement | null;
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

  // and neither must the dev keys, while there is a line being written
  if (isRecording()) return;

  dev?.key(e);
});

// --- the menu ---------------------------------------------------------------
//
// The right-click menu is this app's entire settings surface, and it should stay
// short enough to read without stopping. There is no preferences window and
// there should not be one: a window to hold two lines would be a bigger thing
// than the two lines.
//
// "Start with Windows" is off unless it is asked for, and it is asked once —
// checking it writes a login entry, unchecking it takes it away. The state is
// read back from the machine each time the menu opens rather than remembered
// here, because it can be taken away from the other end (Task Manager's Startup
// tab), and a tick that disagreed with the machine would be worse than no tick.
//
// An installed copy only. In a debug build autostart_status says it is not
// supported and the line is simply absent — see src-tauri/src/autostart.rs.

interface AutostartStatus {
  supported: boolean;
  enabled: boolean;
  label: string;
}

async function autostartStatus(): Promise<AutostartStatus> {
  try {
    return await invoke<AutostartStatus>("autostart_status");
  } catch (error) {
    // Never fatal, and never a warning on the sheet. A machine that will not
    // say whether it starts things at login simply is not offered the choice.
    console.warn("[autostart] could not read the login entry.", error);
    return { supported: false, enabled: false, label: "" };
  }
}

async function buildMenu(): Promise<Menu> {
  const auto = await autostartStatus();

  const startWith = auto.supported
    ? await CheckMenuItem.new({
        id: "autostart",
        text: auto.label,
        checked: auto.enabled,
        action: () => {
          // `auto.enabled` is what the machine said a moment ago, when this
          // menu was built for this press. Toggling from it is therefore
          // toggling from the truth.
          invoke("autostart_set", { enabled: !auto.enabled }).catch((error) =>
            console.error("[autostart] could not change the login entry.", error),
          );
        },
      })
    : null;

  return Menu.new({
    items: [
      ...(startWith ? [startWith, { item: "Separator" as const }] : []),
      {
        id: "quit",
        text: "Quit",
        action: () => {
          invoke("quit");
        },
      },
    ],
  });
}

async function setupContextMenu(): Promise<void> {
  window.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    // Built per press rather than once, so the tick is whatever the machine
    // currently says and not whatever it said at startup.
    buildMenu()
      .then((menu) => menu.popup())
      .catch((error) => console.error("[menu] could not open the menu.", error));
  });
}

setupContextMenu();
