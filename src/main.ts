import "./style.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { Menu } from "@tauri-apps/api/menu";
import { startRenderLoop } from "./render-loop";
import { setupDragging } from "./input";
import { createDevOverlay } from "./dev-overlay";
import { drawScene, cycleVariant, getActiveVariantName } from "./paper";

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
const overlay = createDevOverlay(() => [`paper: ${getActiveVariantName()}`]);

function render(): void {
  const dpr = window.devicePixelRatio || 1;
  drawScene(ctx, window.innerWidth, window.innerHeight, dpr);
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
window.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "v") cycleVariant();
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
