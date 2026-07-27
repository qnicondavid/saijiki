// Borrowing the window, and giving it back.
//
// Two dev views need more room than a 420x300 postcard: the gallery's three
// bands, and the tuning panel's forty sliders. Both grow the window for as long
// as they are open, and the shipped window is never either size.
//
// setSize is a *request*, not a guarantee: a missing capability, a fixed-size
// window, or a window manager that disagrees will all leave it exactly where it
// was, and Tauri does not always throw. So every resize is read back and any
// disagreement is reported. A silent no-op is the worst outcome available here —
// it looks like the layout is wrong when the window simply never moved.
//
// One holder at a time. Whoever asks second takes over, and the size to give
// back is still the one from before the *first* borrow, so handing off between
// the gallery and the panel never leaves the widget stuck at 1120x640.

import { LogicalSize, type PhysicalSize } from "@tauri-apps/api/dpi";

export interface WindowSize {
  width: number;
  height: number;
}

// only the sliver of the Tauri window this needs — kept structural so the
// module stays decoupled and testable
export interface Sizeable {
  innerSize(): Promise<PhysicalSize>;
  setSize(size: LogicalSize | PhysicalSize): Promise<void>;
  setResizable(resizable: boolean): Promise<void>;
  scaleFactor(): Promise<number>;
}

export interface DevWindowSizer {
  /** grow the window for `mode`, releasing whichever mode holds it now */
  enter(mode: string, size: WindowSize): Promise<void>;
  /** give the window back, if `mode` is the one holding it */
  leave(mode: string): Promise<void>;
  holder(): string | null;
  /**
   * One line for the F9 overlay. The window's own size is on the HUD because a
   * refused resize is otherwise invisible: the view just quietly draws into a
   * postcard and the layout gets blamed.
   */
  status(): string;
}

export function createDevWindowSizer(win: Sizeable): DevWindowSizer {
  let mode: string | null = null;
  let wanted: WindowSize | null = null;
  let shipped: PhysicalSize | null = null;
  let refused = false;

  async function apply(size: LogicalSize | PhysicalSize): Promise<void> {
    // the shipped window is fixed-size; lift that only for as long as the
    // resize takes, so the user still cannot drag the widget's edges
    await win.setResizable(true);
    await win.setSize(size);
    await win.setResizable(false);
    await readBack(size);
  }

  // Compare what we asked for against what the window actually became.
  async function readBack(size: LogicalSize | PhysicalSize): Promise<void> {
    const factor = await win.scaleFactor();
    const target = size.type === "Logical" ? size : size.toLogical(factor);
    const got = (await win.innerSize()).toLogical(factor);
    // a pixel or two of rounding across the logical/physical boundary is fine
    const drift = Math.max(
      Math.abs(got.width - target.width),
      Math.abs(got.height - target.height),
    );
    refused = drift > 2;
    if (refused) {
      console.warn(
        `[window] asked for ${target.width}x${target.height} css, window is ` +
          `${got.width}x${got.height}. The resize was refused, so this view is ` +
          `drawing into the wrong space.`,
      );
    }
  }

  return {
    async enter(next: string, size: WindowSize): Promise<void> {
      try {
        if (mode === null) shipped = await win.innerSize();
        mode = next;
        wanted = size;
        await apply(new LogicalSize(size.width, size.height));
      } catch (err) {
        console.error(
          "[window] resizing failed. If this is a permissions error, the missing " +
            "entry belongs in src-tauri/capabilities/default.json.",
          err,
        );
      }
    },

    async leave(which: string): Promise<void> {
      if (mode !== which) return;
      const back = shipped;
      mode = null;
      wanted = null;
      shipped = null;
      refused = false;
      if (!back) return;
      try {
        await apply(back);
      } catch (err) {
        console.error("[window] restoring the window size failed.", err);
      }
    },

    holder: () => mode,

    status(): string {
      if (!mode || !wanted) return "window: shipped size";
      return `window: borrowed by ${mode}, wants ${wanted.width}x${wanted.height}${
        refused ? " -- NOT RESIZED" : ""
      }`;
    },
  };
}
