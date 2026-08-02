import "./style.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { Menu } from "@tauri-apps/api/menu";
import { startRenderLoop } from "./render-loop";
import { registerDragHitTest, setupDragging } from "./input";
import { createDevOverlay } from "./dev-overlay";
import { drawScene, cycleVariant, getActiveVariantName, sheetRect } from "./paper";
import { drawGallery, GALLERY_SIZE } from "./butterfly-gallery";
import { butterflyCacheStats } from "./butterfly-render";
import {
  clockLabel,
  onClockChange,
  resetScrub,
  scrubDays,
  scrubLabel,
  scrubSeasons,
  setAnchor,
  startClockTicker,
  today,
} from "./clock";
import { readDevFlags } from "./dev-flags";
import { lastKnownTrue } from "./kigo-format";
import { createTauriIO } from "./kigo-io-tauri";
import { createStore } from "./store";
import {
  alightedId,
  clearCursor,
  drawFlight,
  endVisit,
  flightBounds,
  flightConfigJson,
  flightKnobs,
  flyerCount,
  hitTest,
  initFlight,
  rebuildFlightPoses,
  restingCount,
  setCursor,
  setSwarm,
  stepFlight,
  swarmDepth,
  swarmFade,
  swarmWorkingSet,
  visitReport,
  type SwarmEntry,
} from "./flight";
import {
  createTuningPanel,
  TUNING_PANEL_INSET,
  TUNING_PANEL_WIDTH,
  TUNING_SIZE,
} from "./tuning-panel";
import { createDevWindowSizer } from "./window-size";

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
const sizer = createDevWindowSizer(appWindow);

// Three views, one at a time. "flight" is the real widget; the other two are dev
// views that borrow a bigger window through the sizer and give it back.
type Mode = "flight" | "gallery" | "tuning";
let mode: Mode = "flight";

initFlight();

const tuner = createTuningPanel({
  knobs: flightKnobs(),
  onRebuild: rebuildFlightPoses,
  dump: flightConfigJson,
});

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

let saijiki: SwarmEntry[] = [];
let storeLabel = "store: loading";

async function loadSaijiki(): Promise<void> {
  const { entries, problems } = await store.scan();
  saijiki = entries.map(({ kigo }) => ({
    id: kigo.id,
    category: kigo.category,
    // The two dates, and they drive the two channels: `created` never moves and
    // sets how far back in the box the butterfly sits, `lastKnownTrue` moves
    // with every touch and sets how much colour is left in it.
    created: kigo.created,
    since: lastKnownTrue(kigo),
    // and the line itself, for the inside of the wings — the only place in the
    // app it is ever shown
    text: kigo.text,
  }));
  if (problems.length > 0) {
    // Reported, never fatal: one hand-edited typo must not take the diary down
    // with it, and it must not vanish silently either.
    console.warn(`[store] ${problems.length} file(s) would not parse:`, problems);
  }
  applySaijiki();
}

function applySaijiki(): void {
  setSwarm(saijiki, today());
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
    const entry = saijiki.find((e) => e.id === id);
    if (entry) entry.since = lastKnownTrue(kigo);
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

// --- the overlay -----------------------------------------------------------

let builtBefore = 0;
let builtLastFrame = 0;

function overlayLines(): string[] {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  const cache = butterflyCacheStats();
  const lines = [
    `paper: ${getActiveVariantName()}`,
    `size: ${w}x${h} css @${dpr}x`,
    sizer.status(),
    `mode: ${mode}`,
    storeLabel,
    clockLabel(),
  ];
  const scrub = scrubLabel();
  if (scrub) lines.push(scrub);
  if (mode !== "gallery") {
    const depth = swarmDepth();
    lines.push(
      `swarm: ${flyerCount()} · ${restingCount()} at rest`,
      // full colour first, the hard floor last. Scrub a season and watch it
      // slide rightwards; scrub back and watch it return.
      `fade: ${swarmFade().join(" · ")}`,
      // the glass first, the back of the box last. The other half of what a
      // season scrub does, and the half the eye cannot count: `}` slides this
      // rightwards as the swarm recedes, `{` slides it back. A zero in the
      // middle means a depth plane nobody is standing on.
      `depth: ${depth.join(" · ")}`,
      // What the swarm will ask the cache for once every butterfly has been
      // through its whole beat — the number the `tiles:` line below is climbing
      // toward. Over capacity here means thrash a second before it starts.
      `  needs ${swarmWorkingSet(depth)} tiles`,
      // Who is at the cursor, how far up the ramp, and at what wingspan. The
      // wingspan is the one to watch: it must walk a short ladder of values and
      // stop, because it is a tile cache key.
      visitLine(),
    );
  }
  // The ways this goes wrong are invisible from the outside and all look like
  // "the motion is janky": MB climbing with the wingspan slider (bloat), builds
  // never settling to zero (churn), and evictions rising while tiles sit pinned
  // at capacity (thrash). The last one is the one to watch — see the note on
  // butterflyCacheStats.
  lines.push(
    `tiles: ${cache.tiles}/${cache.capacity} · ${cache.megabytes.toFixed(1)} MB`,
    `  +${builtLastFrame}/frame · ${cache.builds} built · ${cache.evictions} evicted`,
    `dyes: ${cache.dyes} · ${cache.dyeMegabytes.toFixed(1)} MB`,
  );
  return lines;
}

function visitLine(): string {
  const visit = visitReport();
  if (!visit) return "visit: —";
  return `visit: ${visit.id} ${visit.phase} ${visit.u.toFixed(2)} · ${visit.scale}px`;
}

const overlay = createDevOverlay(overlayLines);

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

  if (mode === "gallery") {
    drawGallery(ctx, w, h, dpr);
  } else {
    // Two rects: where the swarm flies, and where a butterfly that has come
    // forward to the cursor is allowed to be. The second is the window itself —
    // it has left the box, so it may cross the box's rim, but never the edge of
    // the glass, where it would simply be cut off.
    stepFlight(dt, now / 1000, flightBounds(w, h, reservedForPanel(w, h)), {
      x: 0,
      y: 0,
      w: Math.max(0, w - reservedForPanel(w, h)),
      h,
      r: 0,
    });
    drawFlight(ctx, dpr);
    showPointer(alightedId() === null);
  }

  const builds = butterflyCacheStats().builds;
  builtLastFrame = builds - builtBefore;
  builtBefore = builds;

  overlay.update();
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

// How much of the sheet the tuning panel is sitting on. The swarm is kept out
// from under it, so all forty stay visible while their constants are dragged —
// judging motion you cannot see is the failure this avoids.
function reservedForPanel(cssW: number, cssH: number): number {
  if (mode !== "tuning") return 0;
  const sheet = sheetRect(cssW, cssH);
  const panelLeft = cssW - TUNING_PANEL_INSET - TUNING_PANEL_WIDTH;
  return Math.max(0, sheet.x + sheet.w - panelLeft + 8);
}

startRenderLoop({
  window: appWindow,
  render,
  onStateChange: () => overlay.update(),
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

window.addEventListener("mousemove", (e) => setCursor(e.clientX, e.clientY));
// On `document`, not `window`: mouseleave does not bubble, so a listener on the
// window is never on the path of an event that leaves the viewport.
document.addEventListener("mouseleave", clearCursor);

// Dragging asks before it starts. A press on a landed butterfly is claimed here
// and never becomes a drag; a press on bare paper still moves the window, so
// the widget stays draggable from anywhere except the one creature currently in
// the user's hand.
registerDragHitTest(hitTest);

setupDragging(appWindow);

// The click. `hitTest` is asked again rather than trusting the press, because
// between the two the butterfly may have been sent home by a movement — and a
// touch is a deliberate act, not a thing that lands on whatever was there.
window.addEventListener("click", (e) => {
  if (e.button !== 0) return;
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
  if (flags.today) {
    try {
      setAnchor(flags.today);
    } catch (error) {
      console.error(`[dev] --today=${flags.today} is not a date I can read.`, error);
    }
  }
  storeLabel = `store: ${flags.store === "dev" ? "saijiki-dev (synthetic)" : "saijiki"}`;

  // Every time the day moves — a scrub, or midnight — the fade is recomputed
  // and the swarm is recoloured in place.
  onClockChange(applySaijiki);
  startClockTicker();

  try {
    await loadSaijiki();
  } catch (error) {
    console.error("[store] could not read the saijiki; showing the empty sheet.", error);
    storeLabel += " · unreadable";
  }
  overlay.update();
}

start();

// --- dev keys --------------------------------------------------------------
//
// dev: "v" cycles the four paper variants; the active name shows in the F9
// overlay. One will be baked in.
//
// dev: "b" opens the butterfly gallery, "t" the tuning panel. Both need more
// room than the widget's postcard, so the window grows for the duration and is
// handed straight back. Only one may hold it at a time — the sizer remembers the
// shipped size across a hand-off, so going gallery -> panel -> closed still ends
// up at 420x300.
//
// dev: the time scrubber. "[" and "]" move a day, "{" and "}" move a season and
// land on the boundary, "\" comes back to the real today. Seasons are the ones
// worth pressing: fading is seasonal, so a day of scrubbing shows nothing at all
// and a season of it visibly drains the colour out of the swarm — forward to
// bleach it, back to restore it. The F9 overlay says SCRUBBED for as long as
// what is on screen is not the real day.

async function setMode(next: Mode): Promise<void> {
  if (mode === next) next = "flight"; // the same key again closes the view
  mode = next;
  tuner.setVisible(next === "tuning");
  // The window is about to resize under the pointer, so wherever it was is not
  // where it will be. Anyone at the cursor goes home and the next move re-arms
  // the dwell.
  endVisit();
  showPointer(true);

  // Hand straight over rather than releasing first: leaving and re-entering
  // would flick the window down to the postcard and back on every b/t swap.
  if (next === "gallery") await sizer.enter("gallery", GALLERY_SIZE);
  else if (next === "tuning") await sizer.enter("tuning", TUNING_SIZE);
  else {
    const holder = sizer.holder();
    if (holder) await sizer.leave(holder);
  }

  overlay.update();
}

window.addEventListener("keydown", (e) => {
  // the panel has forty number inputs in it; typing a value into one must not
  // also be a shortcut
  const target = e.target as HTMLElement | null;
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

  const k = e.key.toLowerCase();
  if (k === "v") cycleVariant();
  if (k === "b") setMode("gallery");
  if (k === "t") setMode("tuning");

  // The scrub. `{` and `}` arrive as themselves from a shifted bracket, so
  // there is no modifier to check.
  if (e.key === "[") scrubDays(-1);
  if (e.key === "]") scrubDays(1);
  if (e.key === "{") scrubSeasons(-1);
  if (e.key === "}") scrubSeasons(1);
  if (e.key === "\\") resetScrub();
  overlay.update();
});

async function setupContextMenu(): Promise<void> {
  const menu = await Menu.new({
    items: [
      {
        id: "quit",
        text: "Quit",
        action: () => {
          invoke("quit");
        },
      },
    ],
  });

  window.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    menu.popup();
  });
}

setupContextMenu();
