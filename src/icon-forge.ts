// The app's icon, drawn by the app.
//
// There is no separate icon artwork in this repo and there should not be. A
// hand-drawn mark would be a second opinion about what a saijiki butterfly
// looks like, and it would drift the first time BUTTERFLY.gene or the paper
// palette was touched. So the icon is a render: the same diorama the widget
// draws, with one butterfly standing on it, taken through the same renderer in
// the same webview engine that will draw it on the user's machine.
//
// Dev-only, in every sense that matters. It runs when `--icon` is passed, which
// dev.rs only ever reports true for in a debug build, and it hands its bytes to
// a Rust command that a release binary does not contain. main.ts calls it from
// behind an `import.meta.env.DEV` gate as well, so none of this is in the
// shipped bundle at all — see the note there.
//
// --- why it renders each size rather than one and downscaling ---------------
//
// BUTTERFLY.lod exists because "procedural art that only reads at full size is
// useless": below 26px of wingspan the antennae are dropped, below 18 the cut
// edges lose their bevel, and every punched hole under 0.85px is simply never
// cut. That is a *design* for a small butterfly, not a compression of a large
// one, and it is the same design the gallery's smallest band was tuned against.
// Downscaling a 1024px render throws it away and produces mush at 32.
//
// So each PNG is drawn at its own size, with the renderer told the truth about
// how many pixels it has. `tauri icon` still needs one square source to build
// the .ico and .icns from, and gets the largest — which does mean the .ico's
// small layers, the ones Windows actually shows in a taskbar, are downscales.
// Nothing can be done about that from here; it is what `tauri icon` does.

import { invoke } from "@tauri-apps/api/core";
import { deriveButterfly } from "./butterfly";
import { POSE_REST, renderButterfly } from "./butterfly-render";
import { drawScene, sheetRect } from "./paper";
import { paletteFor, type Category } from "./papers";

// --- the choices ------------------------------------------------------------

/**
 * One id, forever.
 *
 * A butterfly's whole appearance derives from its id and nothing else, so an
 * icon is a choice of id and nothing else. This one is the id CLAUDE.md uses in
 * its own worked example of a kigo file, which makes it the closest thing this
 * project has to a canonical creature.
 *
 * It is not, and must never be, an id from anybody's store.
 */
const ICON_ID = "k_7f3a9c";

/** Persimmon — 柿, "the colour of daily life". The warmest of the eight against cream. */
const ICON_PAPER: Category = "humanity";

/**
 * The css-pixel size the diorama is laid out at before being scaled to each
 * icon. PAPER's margins, rim and sheet inset are absolute css px tuned for the
 * widget, so the layout size is what decides how much of the icon is frame:
 * larger here means a thinner rim and a bigger sheet. 420 is the widget's own
 * width, which puts the sheet across about four fifths of the square.
 */
const LAYOUT = 540;

/**
 * Wingspan as a fraction of the sheet's width.
 *
 * Larger than the widget would ever fly one. An icon is looked at across a
 * taskbar rather than across a desk, and at 32 pixels there is room for exactly
 * one shape: the butterfly is it, and the sheet is the ground it is cut from
 * rather than a scene it is somewhere in.
 */
const WINGSPAN = 0.84;

/**
 * What gets written, in pixels. 32 / 128 / 256 are the three PNGs Tauri's
 * bundle config names (256 is `128x128@2x`); 1024 is the source `tauri icon`
 * builds every other format from.
 */
const SIZES = [1024, 256, 128, 32];

// --- the render -------------------------------------------------------------

function drawIcon(size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  // The ground, in layout space. Everything PAPER measures in css px — the
  // rim, the deckle, the drop shadow, the grain — scales with the icon rather
  // than staying a fixed number of pixels, which is the whole reason for
  // laying out at a fixed size and varying the ratio instead.
  const ratio = size / LAYOUT;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  drawScene(ctx, LAYOUT, LAYOUT, ratio);

  // The butterfly, in device space with the transform put back to identity, so
  // `scale` is the wingspan in real pixels and BUTTERFLY.lod is told the truth
  // about how small this is. Under the scaled transform it would be handed 244
  // and be drawing into 18.
  const sheet = sheetRect(LAYOUT, LAYOUT);
  const span = sheet.w * WINGSPAN * ratio;
  const cx = (sheet.x + sheet.w / 2) * ratio;
  // A butterfly reaches slightly further above its origin than below it, so
  // centring the origin would sit it high. Nudge it down by half the difference.
  const cy = (sheet.y + sheet.h / 2) * ratio + span * 0.025;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  renderButterfly(ctx, deriveButterfly(ICON_ID), paletteFor(ICON_PAPER), cx, cy, span, 1, POSE_REST);

  return canvas;
}

function toPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("the canvas would not encode a png"));
      blob
        .arrayBuffer()
        .then((buffer) => resolve(new Uint8Array(buffer)))
        .catch(reject);
    }, "image/png");
  });
}

/**
 * Draw every size and write it beside the crate. Returns the paths, so
 * scripts/icon.mjs can say what it made.
 */
export async function forgeIcons(): Promise<string[]> {
  const written: string[] = [];
  for (const size of SIZES) {
    const png = await toPng(drawIcon(size));
    // A plain array rather than the typed one: this crosses the IPC as JSON and
    // a Uint8Array would arrive as an object of numeric keys.
    const path = await invoke<string>("dev_write_icon", {
      name: `${size}.png`,
      png: Array.from(png),
    });
    console.log(`[icon] ${size}x${size} · ${(png.length / 1024).toFixed(0)} KB · ${path}`);
    written.push(path);
  }
  return written;
}
