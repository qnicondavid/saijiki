// The gallery borrows a bigger window, and the number it asks for has to
// actually hold the three bands. When it didn't, the failure looked like a
// layout bug rather than a window that was the wrong size — so the relationship
// between the two is pinned here instead of being re-checked by eye.

import { describe, expect, it } from "vitest";
import { GALLERY_SIZE, galleryContentHeight } from "./butterfly-gallery";
import { sheetRect } from "./paper";

describe("gallery layout", () => {
  it("fits its bands inside the sheet at the window size it asks for", () => {
    const sheet = sheetRect(GALLERY_SIZE.width, GALLERY_SIZE.height);
    expect(galleryContentHeight()).toBeLessThanOrEqual(sheet.h);
  });

  it("does not fit in the shipped postcard, which is why it resizes at all", () => {
    const postcard = sheetRect(420, 300);
    expect(galleryContentHeight()).toBeGreaterThan(postcard.h);
  });
});
