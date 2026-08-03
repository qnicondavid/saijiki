// The back sheet, on its own, in a browser.
//
// CLAUDE.md: "Every slice must end in something visible. If a change can't be
// judged by looking at the widget, add a way to look at it."
//
// The widget itself is the right place to look at holes and at a birth, and
// both are there — `]` after recording hatches one, and the sheet fills up as
// the diary does. But two of the questions this answers cannot be asked of the
// real widget without living with it for three years first:
//
//   · what a hundred and fifty cuts look like on one sheet, which is the
//     difference between a sheet that has been *worked* and one that has been
//     ruined, and which is a judgment nobody can make from a number alone
//   · whether it still reads at another window size, which the real widget can
//     only answer one drag at a time
//
// So this draws the sheet, the holes and the ceremony against a synthetic set,
// at any size, with the count on a key. It is a dev page: vite serves it at
// /dev/sheet.html and the production build never sees it, because the build's
// only entry is index.html. No Tauri, no store, and no way for it to reach
// anybody's diary — the ids below are made up on the spot.

import "../src/style.css";
import { drawChrysalides, setChrysalides } from "../src/chrysalis";
import { clearHatching, drawEmergence, hatch, stepEmergence } from "../src/emergence";
import { flightBounds, initFlight } from "../src/flight";
import { HOLES, drawHoles, holeCount, setHoles, stepHoles } from "../src/holes";
import { mulberry32 } from "../src/noise";
import { cycleVariant, drawScene, getActiveVariantName, sheetRect } from "../src/paper";
import { CATEGORIES } from "../src/papers";

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const frame = document.querySelector<HTMLDivElement>("#frame")!;
const status = document.querySelector<HTMLDivElement>("#status")!;
const ctx = canvas.getContext("2d")!;

initFlight();

/** Ids in the shape `mintId` makes, so the placement stream sees what it will see. */
const rng = mulberry32(0x5a1_71c1);
const IDS: string[] = [];
while (IDS.length < 150) {
  const id = `k_${Math.floor(rng() * 0xffffff)
    .toString(16)
    .padStart(6, "0")}`;
  if (!IDS.includes(id)) IDS.push(id);
}

let count = 150;
let aged = true;

/**
 * The cuts, as the app would hand them over.
 *
 * `fresh` is 1 for a cut made this season and 0 for one that has settled. A real
 * three-year store is nearly all settled with a handful of recent ones, which is
 * what `aged` stands in for — and the difference between the two is most of what
 * decides whether a hundred and fifty marks read as history or as noise.
 */
function apply(): void {
  setHoles(
    IDS.slice(0, count).map((id, i) => ({
      id,
      fresh: aged ? (i >= count - 3 ? 1 - (count - 1 - i) * 0.3 : 0) : 1,
    })),
  );
}

apply();

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = frame.clientWidth;
  const h = frame.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

new ResizeObserver(resize).observe(frame);
resize();

let last = 0;

function render(now: number): void {
  const dpr = window.devicePixelRatio || 1;
  const w = frame.clientWidth;
  const h = frame.clientHeight;
  const dt = last === 0 ? 0 : Math.min(0.15, (now - last) / 1000);
  last = now;

  drawScene(ctx, w, h, dpr);

  const sheet = sheetRect(w, h);
  stepHoles(dt);
  drawHoles(ctx, sheet, dpr);
  drawChrysalides(ctx, sheet);
  stepEmergence(dt, sheet, flightBounds(w, h), () => {});
  drawEmergence(ctx, sheet, dpr);

  status.textContent =
    `${holeCount()} cut · ${aged ? "aged" : "all fresh"} · ` +
    `${Math.round(w)}x${Math.round(h)} @${dpr}x · sheet ${Math.round(sheet.w)}x${Math.round(sheet.h)} · ` +
    `hole ${(sheet.w * HOLES.size).toFixed(1)}px · paper ${getActiveVariantName()}`;
  requestAnimationFrame(render);
}

requestAnimationFrame(render);

// A hand crank for the frame, so this page can be stepped and photographed from
// outside — a headless browser never composites, so rAF never fires, and the
// canvas would otherwise stay blank for anything that is not a pair of eyes.
// ...and the constants, so a size can be argued with from the console. The
// widget has the tuning panel for this; a page with one object on it does not
// need forty sliders to answer one question.
Object.assign(window, { frame: (t: number) => render(t), HOLES });

// The squares a birth opens out of.
//
// The row is emptied first, exactly as the app does it: the day's division puts
// a kigo that has hatched into the swarm and out of the folded pile, so the row
// stops drawing it the instant it starts to open. Leaving it in leaves a square
// lying under the whole ceremony.
function stage(n: number): void {
  clearHatching();
  const waiting = IDS.slice(count, count + n).map((id, i) => ({
    id,
    category: CATEGORIES[i % CATEGORIES.length],
  }));
  setChrysalides([]);
  hatch(waiting.map((one) => ({ ...one, fade: 1 })));
}

window.addEventListener("keydown", (e) => {
  const n = { "0": 0, "1": 1, "3": 3, "4": 40, "5": 150 }[e.key];
  if (n !== undefined) {
    count = n;
    apply();
  }
  if (e.key === "h") stage(1);
  if (e.key === "H") stage(3);
  if (e.key === "a") {
    aged = !aged;
    apply();
  }
  if (e.key === "v") cycleVariant();
});
