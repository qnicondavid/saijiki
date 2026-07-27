// Render cadence and the RAF loop.
//
// The widget runs all day and must stay alive while the user works: an
// always-on-top ambient widget is looked at *precisely* when something else has
// focus. So hidden (or minimized) fully stops the loop, unfocused keeps it
// running but throttled, and battery throttles further — never freeze.

// single place to reason about render cadence — the dev slider panel (later
// step) will read/write this object directly
export const RENDER_CONFIG = {
  focusedFps: 60,
  unfocusedFps: 10,
  batteryFps: 5,
  minimizedPollMs: 1000,
};

export interface RenderState {
  // covers document.hidden and OS-reported minimize; true window occlusion by
  // another opaque window has no web API and isn't detected
  hidden: boolean;
  focused: boolean;
  onBattery: boolean;
}

// the loop only needs this sliver of the Tauri window — kept structural so the
// module stays decoupled and testable
interface MinimizableWindow {
  isMinimized(): Promise<boolean>;
}

interface RenderLoopOptions {
  window: MinimizableWindow;
  // Drawn once per throttled frame; owns the canvas and any observers (overlay).
  //
  // `now` is the rAF timestamp, and it is the *only* clock motion is allowed to
  // read. Anything that ran off its own timer would keep animating through a
  // throttle and keep running while hidden — resurrecting a full-rate loop
  // behind the cadence rules rather than obeying them.
  render: (now: number) => void;
  // fired when the loop halts, so observers can reflect the stopped state
  onStateChange?: () => void;
}

let minimized = false;
let onBattery = false;

let renderState: RenderState = {
  hidden: document.hidden,
  focused: document.hasFocus(),
  onBattery: false,
};

let renderFn: (now: number) => void = () => {};
let onStateChange: () => void = () => {};
let appWindow: MinimizableWindow | null = null;

let rafId: number | null = null;
let lastFrameTime = 0;
// 0 is a sentinel meaning "not yet baselined" — set on the first rendered frame
let lastFpsSampleTime = 0;
let framesSinceSample = 0;
let currentFps = 0;
let frameMs = 0;

function updateRenderState(): void {
  renderState = {
    hidden: document.hidden || minimized,
    focused: document.hasFocus(),
    onBattery,
  };
}

// the one function every later step should call to reason about cadence
export function getTargetFrameInterval(
  state: RenderState = renderState,
): number | null {
  if (state.hidden) return null;
  let fps = state.focused ? RENDER_CONFIG.focusedFps : RENDER_CONFIG.unfocusedFps;
  if (state.onBattery) fps = Math.min(fps, RENDER_CONFIG.batteryFps);
  return 1000 / fps;
}

export function renderStateLabel(state: RenderState = renderState): string {
  if (state.hidden) return "hidden";
  const parts = [state.focused ? "focused" : "unfocused"];
  if (state.onBattery) parts.push("battery");
  return parts.join(" + ");
}

export function getCurrentFps(): number {
  return currentFps;
}

/**
 * How long the last frames actually took to draw, smoothed.
 *
 * This, not fps, is the number that answers "will forty butterflies hold 60fps
 * on integrated graphics". The loop is throttled to 60, so fps reads 60.0 right
 * up until the moment it collapses; frame time shows the headroom being spent
 * long before that. Under ~16.7ms there is room, and it keeps reading honestly
 * while unfocused at 10fps, when fps deliberately says 10.
 */
export function getFrameMs(): number {
  return frameMs;
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

  if (lastFpsSampleTime === 0) {
    // first rendered frame since (re)start: baseline the sample window here.
    // rAF timestamps are relative to page load, so measuring against 0 would
    // report nonsense fps for the first second.
    lastFpsSampleTime = now;
    framesSinceSample = 0;
  } else {
    framesSinceSample++;
    const elapsed = now - lastFpsSampleTime;
    if (elapsed >= 1000) {
      currentFps = (framesSinceSample * 1000) / elapsed;
      framesSinceSample = 0;
      lastFpsSampleTime = now;
    }
  }

  const started = performance.now();
  renderFn(now);
  const took = performance.now() - started;
  frameMs = frameMs === 0 ? took : frameMs + (took - frameMs) * 0.12;
}

function start(): void {
  if (rafId !== null) return;
  lastFrameTime = 0;
  // re-baseline fps on the first frame after a restart rather than measuring
  // across the paused gap
  lastFpsSampleTime = 0;
  framesSinceSample = 0;
  frameMs = 0;
  rafId = requestAnimationFrame(frame);
}

function stop(): void {
  if (rafId === null) return;
  cancelAnimationFrame(rafId);
  rafId = null;
  onStateChange();
}

// hidden (or minimized) fully stops the loop; unfocused keeps it running,
// throttled
function evaluateRunState(): void {
  updateRenderState();
  if (renderState.hidden) {
    stop();
  } else {
    start();
  }
}

async function pollMinimized(): Promise<void> {
  if (!appWindow) return;
  minimized = await appWindow.isMinimized();
  evaluateRunState();
}

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

export function startRenderLoop(options: RenderLoopOptions): void {
  appWindow = options.window;
  renderFn = options.render;
  onStateChange = options.onStateChange ?? (() => {});

  window.addEventListener("focus", evaluateRunState);
  window.addEventListener("blur", evaluateRunState);
  document.addEventListener("visibilitychange", evaluateRunState);
  evaluateRunState();

  pollMinimized();
  setInterval(pollMinimized, RENDER_CONFIG.minimizedPollMs);

  setupBatteryMonitor();
}
