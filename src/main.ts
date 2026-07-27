import "./style.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { Menu } from "@tauri-apps/api/menu";

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const ctx = canvas.getContext("2d")!;

// placeholder fill until the paper diorama replaces it — alpha keeps the
// transparent window reading as translucent rather than a solid block
const FILL_COLOUR = "rgba(30, 30, 34, 0.55)";

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

let rafId: number | null = null;

function frame(): void {
  const { innerWidth: w, innerHeight: h } = window;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = FILL_COLOUR;
  ctx.fillRect(0, 0, w, h);
  rafId = requestAnimationFrame(frame);
}

function start(): void {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(frame);
}

function stop(): void {
  if (rafId === null) return;
  cancelAnimationFrame(rafId);
  rafId = null;
}

// hidden OR unfocused must fully stop the loop, not throttle it
function evaluateRunState(): void {
  if (document.hidden || !document.hasFocus()) {
    stop();
  } else {
    start();
  }
}

window.addEventListener("focus", evaluateRunState);
window.addEventListener("blur", evaluateRunState);
document.addEventListener("visibilitychange", evaluateRunState);
evaluateRunState();

const appWindow = getCurrentWindow();

// no title bar: the whole surface is the drag handle
window.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  appWindow.startDragging();
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
