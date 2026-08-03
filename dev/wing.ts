// One landed butterfly with its wings open, in a browser.
//
// CLAUDE.md: "Every slice must end in something visible. If a change can't be
// judged by looking at the widget, add a way to look at it."
//
// The widget is the right place to look at a verse being written, and it is
// there: dwell, click, type, press Enter. But the question this step actually
// turns on cannot be asked of the real widget without living with it for ten
// years first — what a wing looks like once thirty verses have gathered on it.
// A wing is small, verses accumulate forever, and the whole design of the
// palimpsest is an answer to a state nobody can reach on purpose.
//
// So this draws one creature at the reading span with any number of verses on
// it, at any size, with the count on a key. Same argument as /dev/sheet.html and
// the same shape: vite serves it at /dev/wing.html and the production build
// never sees it, because the build's only entry is index.html. No Tauri, no
// store, and no way for it to reach anybody's diary — the id and the words below
// are made up on the spot.

import "../src/style.css";
import { deriveButterfly } from "../src/butterfly";
import { butterflyCacheStats, poseOpen, renderButterfly } from "../src/butterfly-render";
import { initFlight } from "../src/flight";
import { cycleVariant, drawScene, getActiveVariantName } from "../src/paper";
import { CATEGORIES, paletteFor, type Category } from "../src/papers";
import { planeLookAt } from "../src/planes";
import { wearOf } from "../src/saijiki";
import { drawWings } from "../src/verse";
import { WING_TEXT } from "../src/wing-text";

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const frame = document.querySelector<HTMLDivElement>("#frame")!;
const status = document.querySelector<HTMLDivElement>("#status")!;
const ctx = canvas.getContext("2d")!;

initFlight();

// Fixed forever, like any id: this page is for comparing one change against the
// one before it, and a fresh creature every reload would make that impossible.
const ID = "k_9c41a7";
const SPEC = deriveButterfly(ID);

const LINE = "leaving my phone in the kitchen at dinner";
const LINE_JA = "夕餉のあいだ台所に携帯を置いておく";

// Obviously synthetic, deliberately: this page ends up in screenshots, and the
// one thing worse than a demo that looks fake is a demo that looks like a
// stranger's diary.
const TAILS = [
  "and dinner is longer now",
  "still true, and easier",
  "kept it through a hard week",
  "forgot for a month, came back",
  "the quiet is the point",
  "nobody has commented on it",
  "harder in winter",
];
const TAILS_JA = ["まだ続いている", "冬はむずかしい", "夕餉が長くなった", "ひと月忘れて、また"];
const LONG = "still doing it, and the evenings have got noticeably longer for it";

let count = 3;
let japanese = false;
let long = false;
let category: Category = "humanity";

function verses(): string[] {
  const tails = japanese ? TAILS_JA : TAILS;
  return Array.from({ length: count }, (_, i) =>
    long ? LONG : `sample verse · ${tails[i % tails.length]}`,
  );
}

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

function render(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = frame.clientWidth;
  const h = frame.clientHeight;

  drawScene(ctx, w, h, dpr);

  // Landed and open, which is the only state the writing exists in: the pose at
  // the top of the opening ramp, the plane's haze fully undone, and the reading
  // span. The same three numbers `drawVisitor` ends its journey on.
  const span = WING_TEXT.span;
  const x = w / 2;
  const y = h / 2;

  // Wear, off the same number as the verses, because in a real store it *is*
  // very nearly the same number: a verse can only be written during a touch, so
  // a much-written wing belongs to a much-handled creature. The two channels are
  // meant to read as one story — the writing says what was true and the softened
  // edges say how often somebody came back to say so — and this is where that
  // can be checked rather than assumed. The colour is held at full so the wear is
  // the only thing moving.
  const palette = paletteFor(category, 1, wearOf({ touches: count }));
  const before = butterflyCacheStats().builds;
  renderButterfly(ctx, SPEC, palette, x, y, span, dpr, poseOpen(999), planeLookAt(0, 1));
  const tiles = butterflyCacheStats().builds - before;

  drawWings(ctx, { id: ID, text: japanese ? LINE_JA : LINE, verses: verses() }, x, y, span, 1, 1);

  status.textContent =
    `${count} verse${count === 1 ? "" : "s"} · wear ${palette.wear} · ` +
    `${japanese ? "japanese" : "latin"}${long ? " · long" : ""} · ${category} · ` +
    `${Math.round(w)}x${Math.round(h)} @${dpr}x · span ${span}px · ` +
    `+${tiles} tiles this frame · paper ${getActiveVariantName()}`;
  requestAnimationFrame(render);
}

requestAnimationFrame(render);

// A hand crank, so this page can be stepped and photographed from outside — a
// headless browser never composites, so rAF never fires and the canvas would
// otherwise stay blank for anything that is not a pair of eyes. And the reading
// constants, so a size can be argued with from the console: the widget has the
// tuning panel for this, and a page with one object on it does not need forty
// sliders to answer one question.
Object.assign(window, {
  frame: () => render(),
  WING_TEXT,
  verses: (n: number) => {
    count = Math.max(0, n);
  },
});

window.addEventListener("keydown", (e) => {
  const n = { "0": 0, "1": 1, "3": 3, "6": 6, "7": 12, "8": 30, "9": 100 }[e.key];
  if (n !== undefined) count = n;
  if (e.key === "+" || e.key === "=") count++;
  if (e.key === "-") count = Math.max(0, count - 1);
  if (e.key === "j") japanese = !japanese;
  if (e.key === "l") long = !long;
  if (e.key === "c") category = CATEGORIES[(CATEGORIES.indexOf(category) + 1) % CATEGORIES.length];
  if (e.key === "v") cycleVariant();
});
