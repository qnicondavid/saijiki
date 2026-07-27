// Dev view: twenty butterflies, three sizes, eight papers, all at once.
//
// Two things are being judged here and neither survives looking at one
// butterfly at a time:
//
//   · Family resemblance. Twenty ids must read as clearly distinct and clearly
//     the same creature. Too alike means the seed isn't reaching enough
//     parameters; unrelated means it's reaching too many.
//   · Legibility at depth. Kigo will eventually sit on different depth planes,
//     and procedural art that only reads at full size is useless. Every row is
//     shown at ~60, ~30 and ~14 px wingspan. If the small one turns to mush,
//     simplify BUTTERFLY.lod until it doesn't.
//
// Toggled with `b`. Never shipped to the user's eye. The ids below are fake:
// there is no store yet and nothing in this step may depend on one.

import { deriveButterfly, type ButterflySpec } from "./butterfly";
import { renderButterfly } from "./butterfly-render";
import { sheetRect } from "./paper";
import { CATEGORIES, paletteFor } from "./papers";

export const GALLERY_IDS: readonly string[] = [
  "k_7f3a9c",
  "k_0b41de",
  "k_c25a08",
  "k_913fb7",
  "k_4e6d20",
  "k_aa17f5",
  "k_2d8c63",
  "k_ff0192",
  "k_58b3ea",
  "k_31c74d",
  "k_9e02a6",
  "k_6417bb",
  "k_d3a58f",
  "k_08e961",
  "k_bc7204",
  "k_45fa39",
  "k_e19d70",
  "k_72b0c8",
  "k_a6531e",
  "k_1f8d47",
];

// The three depth planes we care about, as wingspan in css px, and how many
// columns each band wants. Ten across for the big band, all twenty in a line
// for the small ones — a row of twenty is the fastest way to see whether the
// family holds together.
const BANDS = [
  { scale: 60, cols: 10 },
  { scale: 30, cols: 20 },
  { scale: 14, cols: 20 },
];

// The window this view wants. The widget lives at ~420×300 and twenty
// butterflies at 60px do not fit on that sheet at any honest size — so the dev
// view borrows a bigger window and gives it back on exit.
export const GALLERY_SIZE = { width: 880, height: 420 };

let specs: ButterflySpec[] | null = null;

function gallerySpecs(): ButterflySpec[] {
  if (!specs) specs = GALLERY_IDS.map(deriveButterfly);
  return specs;
}

const PAD = 10; // inset from the sheet's edge
const BAND_GAP = 16;
const LABEL_H = 11; // paper name under the big band
const BAND_LABEL_H = 11; // the "60px" marker above each band

// A butterfly's art reaches about half a wingspan either side of the fold and,
// with antennae, roughly this much above and below its origin. Used to keep
// rows and columns from overlapping and to keep the outermost ones on the sheet.
const REACH_UP = 0.55;
const REACH_DOWN = 0.5;

// A butterfly is drawn from its centre, so half of the outermost one in a row
// hangs past its column and would run off the sheet. Inset every band by the
// widest half-wingspan on show: one shared gutter, so the bands line up with
// each other instead of each ending somewhere slightly different.
const GUTTER = Math.max(...BANDS.map((b) => b.scale)) * 0.5;

export function drawGallery(ctx: CanvasRenderingContext2D, cssW: number, cssH: number): void {
  const sheet = sheetRect(cssW, cssH);
  const all = gallerySpecs();
  const left = sheet.x + PAD;
  const avail = sheet.w - PAD * 2;

  let y = sheet.y + PAD + BAND_LABEL_H;

  ctx.save();
  ctx.textBaseline = "top";

  for (const band of BANDS) {
    const { scale } = band;
    const cols = Math.min(all.length, band.cols);
    const rows = Math.ceil(all.length / cols);
    const labelH = scale >= 50 ? LABEL_H : 0;
    const rowH = scale * (REACH_UP + REACH_DOWN) + labelH + 8;

    const cell = (avail - GUTTER * 2) / cols;

    // which size this band is, quietly, at its left edge
    ctx.fillStyle = "rgba(96,80,58,0.55)";
    ctx.font = "9px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "left";
    ctx.fillText(`${scale}px`, left, y - BAND_LABEL_H);
    ctx.textAlign = "center";

    all.forEach((spec, i) => {
      const cx = left + GUTTER + cell * ((i % cols) + 0.5);
      const rowTop = y + rowH * Math.floor(i / cols);
      const category = CATEGORIES[i % CATEGORIES.length];
      renderButterfly(ctx, spec, paletteFor(category), cx, rowTop + scale * REACH_UP, scale);

      // paper name under the big ones only — the point of the small bands is
      // the silhouette, and a label would flatter it
      if (labelH) {
        ctx.fillStyle = "rgba(96,80,58,0.5)";
        ctx.font = "8px ui-monospace, Menlo, Consolas, monospace";
        ctx.fillText(category, cx, rowTop + scale * (REACH_UP + REACH_DOWN));
      }
    });

    y += rowH * rows + BAND_GAP;
  }

  ctx.restore();
}

// What the bands add up to vertically, so the window size below can be checked
// against it rather than guessed at.
export function galleryContentHeight(): number {
  let h = PAD + BAND_LABEL_H;
  for (const band of BANDS) {
    const rows = Math.ceil(GALLERY_IDS.length / Math.min(GALLERY_IDS.length, band.cols));
    const labelH = band.scale >= 50 ? LABEL_H : 0;
    h += (band.scale * (REACH_UP + REACH_DOWN) + labelH + 8) * rows + BAND_GAP;
  }
  return h - BAND_GAP + PAD;
}
