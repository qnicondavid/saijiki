# saijiki — build prompt series (draft 1)

An ordered set of prompts for Claude Code. Each one is a vertical slice ending in something you can look at and judge. Run them in order, verify, then push.

---

## How to run each step

Start every session with:

```
/model <model>
/effort <level>
```

Then paste the prompt. Every prompt assumes `CLAUDE.md` is committed at the repo root — Claude Code reads it automatically, but the prompts restate the critical constraints anyway, because restating beats relying on it.

### Model choices

| Model | Alias | Use for |
| --- | --- | --- |
| Opus 5 | `claude-opus-5` | Architecture and anything where a wrong decision is expensive to unwind: the season calendar, storage, procedural generation, the motion engine. |
| Sonnet 5 | `claude-sonnet-5` | Implementation against a clear spec: window scaffolding, UI plumbing, the slider panel, mechanical refactors. |
| Haiku 4.5 | `claude-haiku-4-5-20251001` | Chores: config files, `.gitignore`, small mechanical edits. Cheap and fast. |
| Fable 5 | `claude-fable-5` | The microcopy and README pass at the very end. Not for code. |

### Effort levels

`low` · `medium` · `high` · `xhigh` · `max` — default is `high`, and the available range varies slightly by model. Set with `/effort <level>`, or `/effort auto` to reset. You can also drop the word `ultrathink` into a single message to deepen reasoning for that turn only, without changing the session default.

My rule of thumb here: `xhigh` for date maths, procedural generation, and motion, because those are the three places a subtle wrong choice costs a rewrite. `high` for everything else. `low` only for chores.

### After each step

1. Run it and look at it. The verification notes below say what "correct" means.
2. If it's wrong, iterate in the same session — don't move on with a broken foundation.
3. When it's right, commit and push yourself. Claude Code is instructed not to touch git.

---

# Phase 1 — Foundations

Nothing pretty yet, except step 2, which is where the entire art direction gets decided.

---

## Prompt 1 — Scaffold and window

**Model:** Sonnet 5 · **Effort:** high

**Goal:** a translucent postcard that floats above your other windows and can be dragged.

```
Read CLAUDE.md first and follow it.

Set up a Tauri v2 + TypeScript + Vite project at the repo root for a desktop widget
called saijiki. Windows is the primary target; keep macOS and Linux paths correct but
untested.

Requirements:
- A single window: frameless, transparent, always-on-top, 420x300, no taskbar entry,
  not resizable, draggable by pressing anywhere on its surface.
- Window position persists between launches. Store it in the OS app-data directory,
  never in the project folder.
- One full-window <canvas>, with a devicePixelRatio-aware resize handler and a
  requestAnimationFrame loop that currently fills it with a flat colour and nothing else.
- The RAF loop must stop completely — not throttle, stop — when the window is hidden
  or loses focus, and resume on focus.
- Quit via a tray item or a right-click context menu. There is no title bar.
- A .gitignore covering Rust (/target), Node (node_modules, dist), plus a backstop for
  data: any kigo/ directory, any saijiki.json, any *.md inside a store folder.

Do not add icons, UI chrome, or placeholder art. Do not run any git commands.

Stop when `npm run tauri dev` opens a draggable translucent rectangle above my windows.
```

**Verify:** it opens, drags smoothly, stays on top of a maximised browser. Minimise it and confirm in Task Manager that CPU drops to roughly zero. Close and reopen — it should come back where you left it.

> **Two rules in the prompt above turned out to be wrong** — they were spec errors, not implementation mistakes, and they're corrected in prompt 1b rather than by rewriting this step. The render loop should *not* fully stop on blur, and dragging should *not* begin on every mousedown.

---

## Prompt 1b — Corrections to the window shell

**Model:** Sonnet 5 · **Effort:** high

**Goal:** undo two things step 1 got right per the spec and wrong per the product.

```
Read CLAUDE.md, Technical section — two rules there have changed since step 1 was built.

Fix 1 — the render loop must not stop on blur.
src/main.ts currently stops the RAF loop whenever the window loses focus. That is wrong:
this is an always-on-top ambient widget, so it is looked at precisely when something else
has focus. Freezing on blur means the swarm is frozen almost every time it is seen.

Change to:
- Visible and focused: full frame rate.
- Visible but unfocused: keep rendering, throttled to roughly 10fps.
- Genuinely hidden, minimised, or occluded: stop completely.
- On battery, where navigator.getBattery is available: throttle further, but never freeze.
Drive all of this from a single function returning a target frame interval, so every later
step has one place to reason about render cadence.

Fix 2 — window dragging must not swallow clicks.
Any left mousedown currently calls startDragging() immediately, which will eat the touch
gesture the moment butterflies become interactive. Touch is the app's only verb; it must
always win.

Change to:
- On pointerdown, record the position but do not begin dragging.
- Begin dragging only once the pointer moves past a small threshold, about 4px.
- Expose a hit-test hook that later interaction code can register, letting a press be
  claimed by something else (a butterfly) so dragging never starts at all. For now it
  always returns "not claimed".
- A press and release under the threshold fires a click, not a drag.

Also add a dev-only overlay toggled by a keypress, showing current fps, render state
(focused / unfocused / hidden / battery), and the target interval. Keep it for the rest of
the project — step 7 needs it while tuning motion.
```

**Verify:** click another window so saijiki loses focus, then check the overlay — it should still be rendering at roughly 10fps, not sitting at zero. Minimise it and confirm rendering stops entirely. Press and release without moving: the window must not jump. Press and drag: it must move normally.

---

## Prompt 2 — Paper and light

**Model:** Opus 5 · **Effort:** xhigh

**Goal:** the back sheet. This is the most important step in the series — every later decision inherits this surface, and if the paper doesn't convince, nothing built on it will.

```
Read CLAUDE.md first, especially the Visual voice section.

Render the diorama's back wall on the canvas: a single sheet of cream paper lying at
the back of a shallow box, seen straight on. No butterflies yet.

- Procedural paper texture: visible fibre, subtle tooth, faint irregular mottling.
  It must read as handmade stock, not as a noise filter over a beige rectangle.
- The sheet is very slightly warped, so its edges are not perfectly straight and it
  catches light unevenly across the surface.
- A soft key light from the upper left. The sheet casts a contact shadow against the
  box floor and inner walls; the shadow is soft and short, because the sheet is close
  to the wall.
- A gentle inner vignette from the box walls, strongest in the lower right.
- Printed faintly on the sheet: a butterfly crease pattern — the dotted valley and
  mountain fold lines for a butterfly that does not exist yet. Barely visible, like a
  watermark. This is the empty state and it must be lovely on its own.
- Every constant (fibre density, warp amount, light angle, vignette strength, paper
  colour) lives in one exported PAPER config object.
- Must look correct at 1x and 2x device pixel ratio, and repaint correctly on resize.

Canvas 2D only. Generate the texture once into an offscreen canvas and blit it — do not
regenerate noise every frame.
```

**Verify:** leave it running in the corner of your screen for an hour while you do something else. The test is whether you glance at it and are pleased, or glance at it and see a beige rectangle. If it's the latter, iterate here — this is much cheaper to fix now than after seven more layers are sitting on top of it.

---

## Prompt 3 — The saijiki calendar

**Model:** Opus 5 · **Effort:** xhigh

**Goal:** correct season maths, proven by tests. Date logic is where quiet bugs live.

```
Read CLAUDE.md, The model section.

Implement the season calendar as pure functions in src/lib/seasons.ts. No I/O, no
side effects, no Date.now() inside the functions — take the current date as a parameter.

Required:
- seasonOf(date) -> { season, division, bucketId }
  Seasons use the traditional haiku boundaries in CLAUDE.md, not Western ones.
  Divisions are early / middle / late, roughly 30 days each within the season.
  New Year (Jan 1-7) is its own division carved out of winter, not part of it.
- The season year runs Feb 4 to Feb 3. Winter crosses the calendar year, so a January
  date belongs to the season year that began the previous February. Getting this wrong
  is the obvious trap; make it explicit in the code and in the tests.
- orderedBuckets() -> the 16 buckets in chronological order within a season year.
- seasonsSince(fromDate, toDate) -> integer count of season boundaries crossed.
- saturationFor(seasonsSince) -> the fading curve from CLAUDE.md, with a hard 40% floor.

Write Vitest tests covering: every season boundary date and the day either side of it;
the New Year carve-out and its edges; Jan 5 resolving to the previous season year;
leap years; and the full saturation curve including the floor.

Do not integrate this anywhere yet. Tests passing is the deliverable.
```

**Verify:** `npm test` green. Then read the boundary tests yourself — check Feb 3, Feb 4, Nov 6, Nov 7, Dec 31, Jan 1, Jan 7, Jan 8 all land where the table in `CLAUDE.md` says.

---

## Prompt 4 — Storage

**Model:** Opus 5 · **Effort:** high

**Goal:** kigo files that a human can read in Notepad.

```
Read CLAUDE.md, Storage and privacy.

Implement the kigo store in src/lib/store.ts, exactly matching the markdown format in
CLAUDE.md.

- Resolve the store root per platform: %APPDATA%\saijiki on Windows, and the documented
  equivalents on macOS and Linux. An environment variable SAIJIKI_STORE=dev switches the
  root to saijiki-dev instead. Never write outside these roots. Never write into the
  project folder.
- read/create/update/touch operations over kigo/*.md with YAML frontmatter.
- id generation: short, collision-resistant, immutable once assigned. The filename is
  derived from date and a slug of the text and may change; the id may never change.
- Writes are atomic: write to a temp file in the same directory, then rename.
- index.json is a derived cache only. It must be fully rebuildable by scanning kigo/,
  and the app must work correctly if it is deleted at any moment.
- Honour the schema field with a migration hook, even though there is only version 1.

Unit tests against a temp directory. Do not touch a real store in tests.
```

**Verify:** create three entries, then open the `.md` files in Notepad. They should be pleasant to read. Delete `index.json` while the app is closed, reopen, confirm it rebuilds and nothing was lost.

---

## Prompt 5 — Dev harness and time travel

**Model:** Sonnet 5 · **Effort:** medium

**Goal:** see year three on day one. Skipping this is the mistake everyone makes.

```
Read CLAUDE.md.

Build the development harness. It writes only to the dev store (SAIJIKI_STORE=dev) and
must hard-refuse to run against the real store — check the resolved path and throw.

- A seeder script that generates 150 synthetic kigo spread across three years, with
  realistic clustering: some buckets with three entries, some with none. Vary category,
  paper colour, verse count (0 to 6), and touch history — roughly a third touched within
  the current season, a third one or two seasons stale, a third untouched for over a year.
- Entry text is synthetic and obviously fake. Do not invent anything that reads like a
  real person's diary.
- A time-scrubber: the app's notion of "today" comes from a single injectable clock, so
  the whole UI can be rendered as of any date. Expose it as a dev-only keyboard control
  and a CLI flag.
- `npm run seed` and `npm run seed:clear`.

Nothing in this step ships in a release build; guard it behind an env flag.
```

**Verify:** seed, then scrub forward three years and back. The store and any debug output should change coherently. Confirm the seeder refuses to run without `SAIJIKI_STORE=dev`.

---

# Phase 2 — The creature

---

## Prompt 6 — One butterfly, static

**Model:** Opus 5 · **Effort:** xhigh

**Goal:** a cut-paper butterfly generated from `id` alone.

```
Read CLAUDE.md, Visual voice and The seed rule.

Render a single static cut-paper butterfly, generated deterministically from a kigo id.

- A seeded PRNG initialised from the id, and from nothing else. Wing geometry and
  pattern must not depend on text, date, category, or paper colour. Fixing a typo in an
  entry must produce a byte-identical butterfly. Treat this as a hard invariant and add
  a test that asserts it.
- Geometry reads as folded paper: a visible fold line down the body axis, two wing
  panels per side meeting at the fold, and a slightly irregular scissor-cut silhouette.
  The two sides are near-mirrored but not perfectly, as hand-cut paper never is.
- Paper thickness: a thin lighter edge along cut boundaries, and a darker crease at the fold.
- Pattern: simple cut shapes and punched holes, in the entry's paper colour plus one or
  two accents. Papel picado and wycinanki as reference, not photorealistic wing scales.
- A soft cast shadow onto the back sheet, offset consistently with the PAPER light angle.
- No motion, no wing flapping. Centred on the sheet.
- Add a dev view (a keypress) that tiles 20 butterflies from 20 different ids at once.

Canvas 2D. Each butterfly's static art is generated once into an offscreen canvas.
```

**Verify:** three things. Restart five times and confirm the butterfly is identical. Edit the entry text and confirm nothing about the creature changes. Then open the 20-tile view: they should look clearly distinct from one another, and clearly like the same family — if they all look the same, the PRNG isn't reaching enough parameters; if they look unrelated, it's reaching too many.

---

## Prompt 7 — Motion and the slider panel

**Model:** Opus 5 · **Effort:** xhigh

**Goal:** it looks alive rather than animated. This is the step you tune by hand, not by prompting.

```
Read CLAUDE.md.

Give the butterflies flight, and give me sliders to tune it.

Motion model:
- Each butterfly has an independent wing-beat phase and frequency, so the swarm never
  pulses in unison.
- Wandering flight: smooth pseudo-random drift (Perlin or similar), with occasional
  short glides where the wings hold open, and occasional direction changes that read as
  decisions rather than noise.
- A gentle vertical bob coupled to the wing beat, slightly out of phase with it.
- Soft repulsion from the box edges so nothing clips the frame or hovers in a corner.
- Weak mutual avoidance so they don't overlap unpleasantly. Explicitly NOT flocking —
  these are separate memories, not a school of fish. They should feel like individuals
  that happen to share a box.
- Wing rendering during flight: the folded panels rotate about the fold line, so the
  butterfly's silhouette genuinely narrows and widens. Do not fake it by scaling.

Then build a dev-only panel, toggled by a keypress, with live sliders for every motion
constant, plus a "copy config" button that dumps current values as JSON I can paste back
into the config object. Sliders must apply instantly, with no restart.

Target 60fps with 40 butterflies on integrated graphics, and keep the full-stop-on-blur
behaviour from step 1.
```

**Verify:** this is the one worth an afternoon. Open the sliders and tune until it reads as alive rather than mechanical — the tells are unison wing beats, perfectly smooth paths, and anything that looks like it's on a rail. Then paste the config back and leave it running in the corner of your screen for a full working day. Watching it deliberately is not the test; catching it in your peripheral vision for eight hours is.

---

# Phase 3 and beyond — sketched, not yet written

These depend on what phase 2 actually looks like on screen, so I'd rather write them properly once you've seen the swarm move. Order and model recommendations hold.

| # | Step | Model | Effort |
| --- | --- | --- | --- |
| 8 | Depth planes and bucket clustering — kigo from the same season bucket share a plane; near planes sharp with tight shadows, far planes pale and soft. Verify with 150 seeded entries that it reads as a swarm in a box, not soup. | Opus 5 | xhigh |
| 9 | Landing and opening — a butterfly comes to the cursor, settles, opens its wings, and the entry text appears on the inner wing surface in a handwriting face. | Opus 5 | xhigh |
| 10 | Seasonal fading and the touch bloom — the saturation curve applied to render, plus crisp-and-pale versus soft-and-worn texture treatment. | Sonnet 5 | high |
| 11 | The add ceremony — scissors, blank slip, typing, paper choice, the cut from the back sheet, the fold into a chrysalis. The emotional peak; expect to iterate. | Opus 5 | xhigh |
| 12 | Emergence — a chrysalis unfolds on the first open of a later day. | Sonnet 5 | high |
| 13 | Holes in the back sheet — each cut leaves a permanent silhouette; the sheet accumulates them forever. | Opus 5 | high |
| 14 | Verses — adding one line to an open butterfly, and more writing appearing on the wings over time. | Sonnet 5 | medium |
| 15 | Anniversaries — on the day, that butterfly flies to the front of the box and stays there. No badge, no popup. | Sonnet 5 | medium |
| 16 | The field guide — every kigo rendered as an origami fold diagram with numbered steps, and the compact kiyose view. | Opus 5 | xhigh |
| 17 | New Year — the back sheet exported as a printable poster at high resolution. | Sonnet 5 | high |
| 18 | Microcopy and README — every string in the app, checked against the non-negotiables for anything that sounds like an obligation. | Fable 5 | high |

---

## A standing instruction worth repeating in any session

> This repository is public and the user's entries are a private diary. Never read, print, or commit the real store. Use the dev store. Do not run git commands.

Sources for the model and effort details: [Claude Code model configuration](https://support.claude.com/en/articles/11940350-claude-code-model-configuration) · [Thinking and effort levels](https://getclaudekit.com/blog/guide/mechanics/thinking-and-effort-levels)
