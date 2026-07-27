// Two dev views now borrow the same window, which introduces a failure the
// gallery could not have on its own: a hand-off. Going gallery -> panel ->
// closed has to end at the shipped postcard, not at whichever dev size happened
// to be current when the second view opened. That is a bug you only notice
// hours later, when the widget has been quietly sitting at 1120x640 all
// afternoon, so it is pinned here rather than found that way.

import { describe, expect, it, vi } from "vitest";
import { PhysicalSize, type LogicalSize } from "@tauri-apps/api/dpi";
import { createDevWindowSizer, type Sizeable } from "./window-size";

const SHIPPED = { width: 420, height: 300 };
const GALLERY = { width: 880, height: 420 };
const PANEL = { width: 1120, height: 640 };

// A window that agrees with everything asked of it. `obeys: false` models the
// case the read-back exists for: setSize silently doing nothing.
function fakeWindow(opts: { scale?: number; obeys?: boolean } = {}) {
  const scale = opts.scale ?? 1;
  const obeys = opts.obeys ?? true;
  let size = new PhysicalSize(SHIPPED.width * scale, SHIPPED.height * scale);
  const resizable: boolean[] = [];
  const win: Sizeable = {
    innerSize: async () => size,
    setSize: async (s: LogicalSize | PhysicalSize) => {
      if (!obeys) return;
      const logical = s.type === "Logical" ? s : s.toLogical(scale);
      size = new PhysicalSize(logical.width * scale, logical.height * scale);
    },
    setResizable: async (r: boolean) => {
      resizable.push(r);
    },
    scaleFactor: async () => scale,
  };
  return {
    win,
    resizable,
    logical: () => size.toLogical(scale),
  };
}

describe("borrowing the window", () => {
  it("grows for a view and gives the shipped size back", async () => {
    const f = fakeWindow();
    const sizer = createDevWindowSizer(f.win);

    await sizer.enter("gallery", GALLERY);
    expect(f.logical()).toMatchObject(GALLERY);
    expect(sizer.holder()).toBe("gallery");

    await sizer.leave("gallery");
    expect(f.logical()).toMatchObject(SHIPPED);
    expect(sizer.holder()).toBeNull();
  });

  // The reason this module exists rather than two copies of the old code.
  it("hands off between views without losing the shipped size", async () => {
    const f = fakeWindow();
    const sizer = createDevWindowSizer(f.win);

    await sizer.enter("gallery", GALLERY);
    await sizer.enter("tuning", PANEL); // straight over the top, no leave
    expect(f.logical()).toMatchObject(PANEL);
    expect(sizer.holder()).toBe("tuning");

    await sizer.leave("tuning");
    expect(f.logical()).toMatchObject(SHIPPED);
  });

  it("ignores a release from a view that is not holding it", async () => {
    const f = fakeWindow();
    const sizer = createDevWindowSizer(f.win);

    await sizer.enter("tuning", PANEL);
    await sizer.leave("gallery");
    expect(f.logical()).toMatchObject(PANEL);
    expect(sizer.holder()).toBe("tuning");
  });

  // The shipped window is fixed-size; that is lifted only for the length of the
  // resize, so the user still cannot drag the widget's edges.
  it("leaves the window not resizable afterwards", async () => {
    const f = fakeWindow();
    const sizer = createDevWindowSizer(f.win);
    await sizer.enter("gallery", GALLERY);
    expect(f.resizable[f.resizable.length - 1]).toBe(false);
    await sizer.leave("gallery");
    expect(f.resizable[f.resizable.length - 1]).toBe(false);
  });

  it("survives a non-integer scale factor without drifting", async () => {
    const f = fakeWindow({ scale: 1.5 });
    const sizer = createDevWindowSizer(f.win);
    await sizer.enter("gallery", GALLERY);
    await sizer.leave("gallery");
    expect(f.logical().width).toBeCloseTo(SHIPPED.width, 6);
    expect(f.logical().height).toBeCloseTo(SHIPPED.height, 6);
  });
});

describe("the read-back check", () => {
  it("says nothing when the window agreed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = fakeWindow();
    const sizer = createDevWindowSizer(f.win);
    await sizer.enter("gallery", GALLERY);
    expect(warn).not.toHaveBeenCalled();
    expect(sizer.status()).not.toContain("NOT RESIZED");
    warn.mockRestore();
  });

  // A refused resize is otherwise invisible: the view just quietly draws into a
  // postcard and the layout gets blamed.
  it("reports a resize that was silently refused", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = fakeWindow({ obeys: false });
    const sizer = createDevWindowSizer(f.win);
    await sizer.enter("gallery", GALLERY);
    expect(warn).toHaveBeenCalledOnce();
    expect(sizer.status()).toContain("NOT RESIZED");
    warn.mockRestore();
  });
});
