import "./style.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { Menu } from "@tauri-apps/api/menu";

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const ctx = canvas.getContext("2d")!;

// placeholder fill until the paper diorama replaces it — alpha keeps the
// transparent window reading as translucent rather than a solid block
const FILL_COLOUR = "rgba(30, 30, 34, 0.55)";

// single place to reason about render cadence — the dev slider panel (later
// step) will read/write this object directly
const RENDER_CONFIG = {
  focusedFps: 60,
  unfocusedFps: 10,
  batteryFps: 5,
  minimizedPollMs: 1000,
};

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

interface RenderState {
  // covers document.hidden and OS-reported minimize; true window occlusion by
  // another opaque window has no web API and isn't detected
  hidden: boolean;
  focused: boolean;
  onBattery: boolean;
}

let minimized = false;
let onBattery = false;

let renderState: RenderState = {
  hidden: document.hidden,
  focused: document.hasFocus(),
  onBattery: false,
};

function updateRenderState(): void {
  renderState = {
    hidden: document.hidden || minimized,
    focused: document.hasFocus(),
    onBattery,
  };
}

// the one function every later step should call to reason about cadence
function getTargetFrameInterval(state: RenderState = renderState): number | null {
  if (state.hidden) return null;
  let fps = state.focused ? RENDER_CONFIG.focusedFps : RENDER_CONFIG.unfocusedFps;
  if (state.onBattery) fps = Math.min(fps, RENDER_CONFIG.batteryFps);
  return 1000 / fps;
}

function renderStateLabel(state: RenderState = renderState): string {
  if (state.hidden) return "hidden";
  const parts = [state.focused ? "focused" : "unfocused"];
  if (state.onBattery) parts.push("battery");
  return parts.join(" + ");
}

let rafId: number | null = null;
let lastFrameTime = 0;
let lastFpsSampleTime = 0;
let framesSinceSample = 0;
let currentFps = 0;

function render(): void {
  const { innerWidth: w, innerHeight: h } = window;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = FILL_COLOUR;
  ctx.fillRect(0, 0, w, h);
  updateOverlay();
}

function frame(now: number): void {
  rafId = requestAnimationFrame(frame);

  const interval = getTargetFrameInterval();
  if (interval === null) {
    // start()/stop() should gate this before it's ever reached — halt rather
    // than spin an unthrottled loop that never renders
    stop();
    return;
  }
  if (now - lastFrameTime < interval) return;
  lastFrameTime = now;

  framesSinceSample++;
  if (now - lastFpsSampleTime >= 1000) {
    currentFps = (framesSinceSample * 1000) / (now - lastFpsSampleTime);
    framesSinceSample = 0;
    lastFpsSampleTime = now;
  }

  render();
}

function start(): void {
  if (rafId !== null) return;
  lastFrameTime = 0;
  rafId = requestAnimationFrame(frame);
}

function stop(): void {
  if (rafId === null) return;
  cancelAnimationFrame(rafId);
  rafId = null;
  updateOverlay();
}

// hidden (or minimized) fully stops the loop; unfocused keeps it running,
// throttled — an always-on-top ambient widget is looked at precisely when
// something else has focus
function evaluateRunState(): void {
  updateRenderState();
  if (renderState.hidden) {
    stop();
  } else {
    start();
  }
}

window.addEventListener("focus", evaluateRunState);
window.addEventListener("blur", evaluateRunState);
document.addEventListener("visibilitychange", evaluateRunState);
evaluateRunState();

async function pollMinimized(): Promise<void> {
  minimized = await appWindow.isMinimized();
  evaluateRunState();
}

pollMinimized();
setInterval(pollMinimized, RENDER_CONFIG.minimizedPollMs);

async function setupBatteryMonitor(): Promise<void> {
  const nav = navigator as Navigator & { getBattery?: () => Promise<any> };
  if (!nav.getBattery) return;
  const battery = await nav.getBattery();
  const update = () => {
    onBattery = !battery.charging;
    evaluateRunState();
  };
  battery.addEventListener("chargingchange", update);
  update();
}

setupBatteryMonitor();

// --- dragging -----------------------------------------------------------
//
// touch is the app's only verb and must always win: dragging begins only
// after the pointer moves past a small threshold, and never when the press
// began on something a hit-test claims (a butterfly, later)

const DRAG_THRESHOLD_PX = 4;

type HitTestFn = () => boolean;
let dragHitTest: HitTestFn = () => false;

export function registerDragHitTest(fn: HitTestFn): void {
  dragHitTest = fn;
}

let pointerDownPos: { x: number; y: number } | null = null;
let pressClaimed = false;
let isDragging = false;

window.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  pointerDownPos = { x: e.clientX, y: e.clientY };
  pressClaimed = dragHitTest();
  isDragging = false;
});

window.addEventListener("mousemove", (e) => {
  if (!pointerDownPos || pressClaimed || isDragging) return;
  const dx = e.clientX - pointerDownPos.x;
  const dy = e.clientY - pointerDownPos.y;
  if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
    isDragging = true;
    appWindow.startDragging();
  }
});

window.addEventListener("mouseup", () => {
  // a press and release under the threshold falls through as a plain click —
  // nothing to do here, we just never started a drag for it
  pointerDownPos = null;
  isDragging = false;
  pressClaimed = false;
});

// --- dev overlay ----------------------------------------------------------

const overlay = document.createElement("div");
overlay.id = "dev-overlay";
overlay.className = "dev-overlay";
document.body.appendChild(overlay);

let overlayVisible = false;

function updateOverlay(): void {
  if (!overlayVisible) return;
  const interval = getTargetFrameInterval();
  overlay.textContent =
    `fps: ${currentFps.toFixed(1)}\n` +
    `state: ${renderStateLabel()}\n` +
    `target: ${interval === null ? "stopped" : `${interval.toFixed(1)}ms`}`;
}

window.addEventListener("keydown", (e) => {
  if (e.key !== "F9") return;
  overlayVisible = !overlayVisible;
  overlay.style.display = overlayVisible ? "block" : "none";
  updateOverlay();
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
