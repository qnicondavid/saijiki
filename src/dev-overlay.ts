// Dev overlay: a monospace HUD toggled with F9, showing render cadence and
// whatever extra lines the caller wants to surface (e.g. the active paper
// variant). Purely diagnostic — never shipped to the user's eye.

import {
  getCurrentFps,
  getFrameMs,
  getTargetFrameInterval,
  renderStateLabel,
} from "./render-loop";

export interface DevOverlay {
  // called after each rendered frame (and when the loop stops) to refresh
  update(): void;
}

// extraLines lets later steps add their own diagnostics without this module
// needing to know about them
export function createDevOverlay(extraLines?: () => string[]): DevOverlay {
  const overlay = document.createElement("div");
  overlay.id = "dev-overlay";
  overlay.className = "dev-overlay";
  document.body.appendChild(overlay);

  let visible = false;

  function update(): void {
    if (!visible) return;
    const interval = getTargetFrameInterval();
    const lines = [
      `fps: ${getCurrentFps().toFixed(1)}`,
      // the headroom number: fps is pinned at its target and stays there until
      // it suddenly doesn't, but frame time shows the budget being spent
      `frame: ${getFrameMs().toFixed(2)}ms / 16.67`,
      `state: ${renderStateLabel()}`,
      `target: ${interval === null ? "stopped" : `${interval.toFixed(1)}ms`}`,
    ];
    if (extraLines) lines.push(...extraLines());
    overlay.textContent = lines.join("\n");
  }

  window.addEventListener("keydown", (e) => {
    if (e.key !== "F9") return;
    visible = !visible;
    overlay.style.display = visible ? "block" : "none";
    update();
  });

  return { update };
}
