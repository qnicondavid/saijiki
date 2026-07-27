import "./style.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize, type PhysicalSize } from "@tauri-apps/api/dpi";
import { invoke } from "@tauri-apps/api/core";
import { Menu } from "@tauri-apps/api/menu";
import { startRenderLoop } from "./render-loop";
import { setupDragging } from "./input";
import { createDevOverlay } from "./dev-overlay";
import { drawScene, cycleVariant, getActiveVariantName } from "./paper";
import { drawGallery, GALLERY_SIZE } from "./butterfly-gallery";

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

let galleryOpen = false;

// The window's own size is on the HUD because a refused resize is otherwise
// invisible: the gallery just quietly draws into a postcard and the layout gets
// blamed. This is the number to look at first when it looks wrong.
function overlayLines(): string[] {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  const lines = [
    `paper: ${getActiveVariantName()}`,
    `window: ${w}x${h} css @${dpr}x`,
  ];
  if (galleryOpen) {
    const want = `${GALLERY_SIZE.width}x${GALLERY_SIZE.height}`;
    const fits = w >= GALLERY_SIZE.width - 2 && h >= GALLERY_SIZE.height - 2;
    lines.push(`gallery: on, wants ${want}${fits ? "" : " -- NOT RESIZED"}`);
  } else {
    lines.push("gallery: off");
  }
  return lines;
}

const overlay = createDevOverlay(overlayLines);

function render(): void {
  const dpr = window.devicePixelRatio || 1;
  const { innerWidth: w, innerHeight: h } = window;
  drawScene(ctx, w, h, dpr);
  if (galleryOpen) drawGallery(ctx, w, h);
  overlay.update();
}

startRenderLoop({
  window: appWindow,
  render,
  onStateChange: () => overlay.update(),
});

setupDragging(appWindow);

// dev: cycle the four paper variants with "v"; the active name shows in the
// F9 overlay. One will be baked in.
//
// dev: "b" opens the butterfly gallery. Twenty ids at three sizes need more
// room than the widget's postcard, so the window grows for the duration and is
// handed straight back — the shipped window is never this size.
//
// setSize is a request, not a guarantee: a missing capability, a fixed-size
// window, or a window manager that disagrees will all leave it exactly where it
// was, and Tauri does not always throw. So every resize is read back and any
// disagreement is reported. A silent no-op is the worst outcome here — it looks
// like the layout is wrong when the window simply never moved.
let sizeBeforeGallery: PhysicalSize | null = null;

async function toggleGallery(): Promise<void> {
  galleryOpen = !galleryOpen;
  try {
    // the shipped window is fixed-size; lift that only for as long as the
    // resize takes, so the user still cannot drag the widget's edges
    await appWindow.setResizable(true);
    let wanted: LogicalSize | PhysicalSize | null = null;
    if (galleryOpen) {
      sizeBeforeGallery = await appWindow.innerSize();
      wanted = new LogicalSize(GALLERY_SIZE.width, GALLERY_SIZE.height);
    } else {
      wanted = sizeBeforeGallery;
      sizeBeforeGallery = null;
    }
    if (wanted) await appWindow.setSize(wanted);
    await appWindow.setResizable(false);
    if (wanted) await reportResize(wanted);
  } catch (err) {
    console.error(
      "[gallery] resizing the window failed. If this is a permissions error, the " +
        "missing entry belongs in src-tauri/capabilities/default.json.",
      err,
    );
  }
  overlay.update();
}

// Compare what we asked for against what the window actually became.
async function reportResize(wanted: LogicalSize | PhysicalSize): Promise<void> {
  const factor = await appWindow.scaleFactor();
  const target = wanted.type === "Logical" ? wanted : wanted.toLogical(factor);
  const got = (await appWindow.innerSize()).toLogical(factor);
  // a pixel or two of rounding across the logical/physical boundary is fine
  const drift = Math.max(Math.abs(got.width - target.width), Math.abs(got.height - target.height));
  if (drift > 2) {
    console.warn(
      `[gallery] asked for ${target.width}×${target.height} css, window is ` +
        `${got.width}×${got.height}. The resize was refused, so the gallery is ` +
        `drawing into the wrong space.`,
    );
  }
}

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "v") cycleVariant();
  if (k === "b") toggleGallery();
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
