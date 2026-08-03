// Everything behind a dev key, in one place, so that a release build can be
// made not to contain it.
//
// --- why it is a module rather than a handful of `if`s ---------------------
//
// The affordances here are not merely unwanted in a shipped copy, they are
// actively wrong in one. Pressing `t` resizes the window to 1120x640 and fills
// it with forty number inputs; `b` replaces the diary with twenty synthetic
// creatures that are not anybody's; `}` walks the app four seasons into the
// future and drains the colour out of the swarm, which — for someone who does
// not know it is a scrubber — is indistinguishable from the app having lost
// their entries. None of that can be left reachable by a stray keystroke.
//
// Vite replaces `import.meta.env.DEV` with the literal `false` when it builds,
// so main.ts's one call to `installDevHarness` sits in a branch that is gone
// before Rollup runs. The import is then unused and this module goes with it,
// and so do butterfly-gallery, tuning-panel, dev-overlay, dev-ids and
// window-size, none of which anything else imports. That is the point of
// collecting them behind a single entry rather than gating each key: one dead
// reference, and the whole subtree falls off.
//
// The two command-line switches are deliberately *not* here. `--store=dev` and
// `--today=` are parsed in Rust and survive into a release build, because a
// shipped copy being pointable at the synthetic store is how the app gets
// demonstrated without opening someone's diary, and neither flag can select the
// real store — that is what doing nothing selects. See src-tauri/src/dev.rs.

import { butterflyCacheStats } from "./butterfly-render";
import { drawGallery, GALLERY_SIZE } from "./butterfly-gallery";
import { chrysalisCount } from "./chrysalis";
import {
  clockLabel,
  resetScrub,
  scrubDays,
  scrubLabel,
  scrubSeasons,
} from "./clock";
import { createDevOverlay } from "./dev-overlay";
import { emergenceConfigJson, emergenceKnobs, emergenceStatus } from "./emergence";
import {
  flightConfigJson,
  flightKnobs,
  flyerCount,
  rebuildFlightPoses,
  restingCount,
  swarmDepth,
  swarmFade,
  swarmWorkingSet,
} from "./flight";
import { holeCount } from "./holes";
import { cycleVariant, getActiveVariantName, sheetRect } from "./paper";
import { recordConfigJson, recordKnobs, recordStatus } from "./record";
import {
  createTuningPanel,
  TUNING_PANEL_INSET,
  TUNING_PANEL_WIDTH,
  TUNING_SIZE,
} from "./tuning-panel";
import { visitReport } from "./visit";
import { createDevWindowSizer, type Sizeable } from "./window-size";

/**
 * Three views, one at a time. "flight" is the real widget; the other two are
 * dev views that borrow a bigger window through the sizer and give it back.
 */
export type Mode = "flight" | "gallery" | "tuning";

export interface DevHost {
  window: Sizeable;
  /** Which store the widget is talking to, as a line for the overlay. */
  storeLabel(): string;
  /**
   * Put the world back to rest, because the window is about to change size
   * under the pointer. Whatever main.ts has to do — send the visitor home, put
   * an unfinished slip away, finish a birth, redraw the piles.
   */
  settle(): void;
}

export interface DevHarness {
  /** True while a dev view is drawing instead of the widget. */
  drawsInsteadOfWidget(): boolean;
  drawView(ctx: CanvasRenderingContext2D, cssW: number, cssH: number, dpr: number): void;
  /** How much of the sheet's right-hand side the tuning panel is sitting on. */
  reservedWidth(cssW: number, cssH: number): number;
  /** A keypress that the slip did not want. */
  key(e: KeyboardEvent): void;
  /** End of a rendered frame: count the tile builds, refresh the overlay. */
  endFrame(): void;
  /** Refresh the overlay out of band — after a key, a resize, a store load. */
  update(): void;
}

export function installDevHarness(host: DevHost): DevHarness {
  let mode: Mode = "flight";

  const sizer = createDevWindowSizer(host.window);

  const tuner = createTuningPanel({
    knobs: [...flightKnobs(), ...recordKnobs(), ...emergenceKnobs()],
    onRebuild: rebuildFlightPoses,
    dump: () => `${flightConfigJson()}\n${recordConfigJson()}\n${emergenceConfigJson()}`,
  });

  // --- the overlay ---------------------------------------------------------

  let builtBefore = 0;
  let builtLastFrame = 0;

  function visitLine(): string {
    const visit = visitReport();
    if (!visit) return "visit: —";
    return `visit: ${visit.id} ${visit.phase} ${visit.u.toFixed(2)} · ${visit.scale}px`;
  }

  function overlayLines(): string[] {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    const cache = butterflyCacheStats();
    const lines = [
      `paper: ${getActiveVariantName()}`,
      `size: ${w}x${h} css @${dpr}x`,
      sizer.status(),
      `mode: ${mode}`,
      host.storeLabel(),
      clockLabel(),
    ];
    const scrub = scrubLabel();
    if (scrub) lines.push(scrub);
    if (mode !== "gallery") {
      const depth = swarmDepth();
      lines.push(
        `swarm: ${flyerCount()} · ${restingCount()} at rest`,
        // full colour first, the hard floor last. Scrub a season and watch it
        // slide rightwards; scrub back and watch it return.
        `fade: ${swarmFade().join(" · ")}`,
        // the glass first, the back of the box last. The other half of what a
        // season scrub does, and the half the eye cannot count: `}` slides this
        // rightwards as the swarm recedes, `{` slides it back. A zero in the
        // middle means a depth plane nobody is standing on.
        `depth: ${depth.join(" · ")}`,
        // What the swarm will ask the cache for once every butterfly has been
        // through its whole beat — the number the `tiles:` line below is climbing
        // toward. Over capacity here means thrash a second before it starts.
        `  needs ${swarmWorkingSet(depth)} tiles`,
        // Who is at the cursor, how far up the ramp, and at what wingspan. The
        // wingspan is the one to watch: it must walk a short ladder of values and
        // stop, because it is a tile cache key.
        visitLine(),
        // The ceremony. `n/N` is how much of the cap is spent — never the words
        // themselves, which are the one thing in this app that must not appear in
        // a screenshot of the developer overlay.
        recordStatus(),
        // Folded squares waiting for their day, and holes cut in the back sheet.
        // With one entry recorded today this reads `1 folded · 1 cut`, which is
        // the whole state of a real first week. Scrub back past that day and both
        // numbers go to zero, which is the claim that the sheet is a record of
        // what has happened rather than of what is in the store.
        `sheet: ${chrysalisCount()} folded · ${holeCount()} cut`,
        // The queue of births. Empty almost always; `]` after recording is the
        // shortest way to see it, and `{` then `}` hatches a whole season's worth
        // one after another.
        emergenceStatus(),
      );
    }
    // The ways this goes wrong are invisible from the outside and all look like
    // "the motion is janky": MB climbing with the wingspan slider (bloat), builds
    // never settling to zero (churn), and evictions rising while tiles sit pinned
    // at capacity (thrash). The last one is the one to watch — see the note on
    // butterflyCacheStats.
    lines.push(
      `tiles: ${cache.tiles}/${cache.capacity} · ${cache.megabytes.toFixed(1)} MB`,
      `  +${builtLastFrame}/frame · ${cache.builds} built · ${cache.evictions} evicted`,
      `dyes: ${cache.dyes} · ${cache.dyeMegabytes.toFixed(1)} MB`,
    );
    return lines;
  }

  const overlay = createDevOverlay(overlayLines);

  // --- the views -----------------------------------------------------------
  //
  // "b" opens the butterfly gallery, "t" the tuning panel. Both need more room
  // than the widget's postcard, so the window grows for the duration and is
  // handed straight back. Only one may hold it at a time — the sizer remembers
  // the shipped size across a hand-off, so going gallery -> panel -> closed
  // still ends up at 420x300.

  async function setMode(next: Mode): Promise<void> {
    if (mode === next) next = "flight"; // the same key again closes the view
    mode = next;
    tuner.setVisible(next === "tuning");
    // The window is about to resize under the pointer, so wherever anything was
    // is not where it will be.
    host.settle();

    // Hand straight over rather than releasing first: leaving and re-entering
    // would flick the window down to the postcard and back on every b/t swap.
    if (next === "gallery") await sizer.enter("gallery", GALLERY_SIZE);
    else if (next === "tuning") await sizer.enter("tuning", TUNING_SIZE);
    else {
      const holder = sizer.holder();
      if (holder) await sizer.leave(holder);
    }

    overlay.update();
  }

  return {
    drawsInsteadOfWidget: () => mode === "gallery",

    drawView(ctx, cssW, cssH, dpr) {
      drawGallery(ctx, cssW, cssH, dpr);
    },

    // The swarm is kept out from under the panel, so all forty stay visible
    // while their constants are dragged — judging motion you cannot see is the
    // failure this avoids.
    reservedWidth(cssW, cssH) {
      if (mode !== "tuning") return 0;
      const sheet = sheetRect(cssW, cssH);
      const panelLeft = cssW - TUNING_PANEL_INSET - TUNING_PANEL_WIDTH;
      return Math.max(0, sheet.x + sheet.w - panelLeft + 8);
    },

    // dev: "v" cycles the four paper variants; the active name shows in the F9
    // overlay. One will be baked in.
    //
    // dev: the time scrubber. "[" and "]" move a day, "{" and "}" move a season
    // and land on the boundary, "\" comes back to the real today. Seasons are
    // the ones worth pressing: fading is seasonal, so a day of scrubbing shows
    // nothing at all and a season of it visibly drains the colour out of the
    // swarm — forward to bleach it, back to restore it. The F9 overlay says
    // SCRUBBED for as long as what is on screen is not the real day.
    key(e) {
      const k = e.key.toLowerCase();
      if (k === "v") cycleVariant();
      if (k === "b") setMode("gallery");
      if (k === "t") setMode("tuning");

      // `{` and `}` arrive as themselves from a shifted bracket, so there is no
      // modifier to check.
      if (e.key === "[") scrubDays(-1);
      if (e.key === "]") scrubDays(1);
      if (e.key === "{") scrubSeasons(-1);
      if (e.key === "}") scrubSeasons(1);
      if (e.key === "\\") resetScrub();
      overlay.update();
    },

    endFrame() {
      const builds = butterflyCacheStats().builds;
      builtLastFrame = builds - builtBefore;
      builtBefore = builds;
      overlay.update();
    },

    update: () => overlay.update(),
  };
}
