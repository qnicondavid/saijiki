# saijiki — build prompts

The prompts this app was built from, in the order they were actually run, plus the ones still to come.

This started as a plan and became a record. The order below is not the order it was planned in, and the difference is the interesting part — see **Build order** for why.

---

## How to run each step

Start every session with:

```
/model <model>
/effort <level>
```

Then paste the prompt. Every prompt assumes `CLAUDE.md` is at the repo root — Claude Code reads it automatically, but the prompts restate the critical constraints anyway, because restating beats relying on it.

### Model choices

| Model | Alias | Use for |
| --- | --- | --- |
| Opus 5 | `claude-opus-5` | Architecture and anything where a wrong decision is expensive to unwind: the season calendar, storage, procedural generation, the motion engine. |
| Sonnet 5 | `claude-sonnet-5` | Implementation against a clear spec: window scaffolding, UI plumbing, mechanical refactors. |
| Haiku 4.5 | `claude-haiku-4-5-20251001` | Chores: config files, `.gitignore`, small mechanical edits. |
| Fable 5 | `claude-fable-5` | The microcopy and README pass at the very end. Not for code. |

### Effort levels

`low` · `medium` · `high` · `xhigh` · `max` — default `high`, and the available range varies slightly by model. Set with `/effort <level>`, or `/effort auto` to reset. Dropping `ultrathink` into a message deepens reasoning for that turn only.

Rule of thumb: `xhigh` for date maths, procedural generation, and motion, because those are the three places a subtle wrong choice costs a rewrite. `high` for everything else. `low` only for chores.

### After each step

1. Run it and look at it. Each prompt's verification notes say what "correct" means.
2. If it's wrong, iterate in the same session — don't move on from a broken foundation.
3. When it's right, commit and push yourself. Claude Code is instructed not to touch git.

---

## Build order

| # | Step | Status |
| --- | --- | --- |
| 1 | Scaffold and window | done |
| 1b | Corrections to the window shell | done |
| 2 | Paper and light | done |
| 6 | The butterfly | done |
| 6b | The gallery window fix | done |
| 7 | Flight and the tuning panel | done |
| 3 + 4 | The saijiki calendar and the kigo store | done |
| 5 | The dev harness, wired to the swarm | done |
| 8 | Depth planes and bucket clustering | next |
| 9 | Landing, opening, reading | |
| 10 | The touch bloom (fading itself shipped with step 5) | partial |
| 11 | The add ceremony | |
| 12 | Emergence | |
| 13 | Holes in the back sheet | |
| 14 | Verses | |
| 15 | Anniversaries | |
| 16 | The field guide | |
| 17 | The New Year poster | |
| 18 | Microcopy and README | |

**Why the order changed.** The plan put the calendar, storage and dev harness before the butterfly. After step 2 proved the paper looked right, that ordering was wrong: it had three steps of untestable plumbing standing between us and the last real question — whether a procedurally generated cut-paper butterfly would look like a creature or like a moth made of construction paper. Since a butterfly derives from its id and nothing else, it needed no storage at all. So 6 and 7 jumped the queue on twenty hardcoded ids, and the plumbing followed once the art had cleared.

Steps 3 and 4 were then merged, because both end in green tests rather than in something to look at, and `season` is a field in the kigo frontmatter. Step 5 absorbed the fading half of step 10, because 150 seeded entries with varied touch histories tell you nothing if they all render at full colour.

**1b and 6b were not planned.** Both fix mistakes: 1b corrects two rules in prompt 1 that were wrong as specified, and 6b fixes a silent window-resize failure. They're kept in place rather than folded back into the prompts they correct, because what went wrong is more useful than a clean-looking document.

---

# Phase 1 — Foundations

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

> **Two rules above turned out to be wrong** — spec errors, not implementation mistakes, corrected in 1b rather than by rewriting this step. The render loop should *not* fully stop on blur, and dragging should *not* begin on every mousedown.

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

**Verify:** click another window so saijiki loses focus, then check the overlay — still rendering at roughly 10fps, not zero. Minimise it and confirm rendering stops. Press and release without moving: the window must not jump. Press and drag: it must move normally.

---

## Prompt 2 — Paper and light

**Model:** Opus 5 · **Effort:** xhigh

**Goal:** the back sheet. The most important step in the series — every later decision inherits this surface.

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

**Verify:** leave it running in the corner of your screen for an hour while doing something else. The test is whether you glance at it and are pleased, or glance at it and see a beige rectangle.

**Amendment made at run time:** the window is transparent and frameless, so the widget must read as a physical object on the desktop — rounded silhouette and a diffuse drop shadow — not a rectangle of paint. Four paper variants were requested, cycled with a keypress, so a choice could be made by eye rather than by re-prompting.

---

# Phase 2 — The creature

Run out of order, ahead of the plumbing. See **Build order**.

## Prompt 6 — The butterfly

**Model:** Opus 5 · **Effort:** xhigh

```
Read CLAUDE.md first — Visual voice and The seed rule especially. New session. Steps 1,
1b and 2 are built and committed.

We are deliberately doing this before storage and the season calendar. There is no store
yet, so work from a hardcoded list of fake kigo ids. Nothing here may depend on
persistence.

PART A — small refactor first.

src/paper.ts contains mulberry32, hash, smooth, valueNoise and fbm. Move them into
src/noise.ts and import from both modules. The butterfly needs the same primitives and
they must not be duplicated.

PART B — the butterfly. Split genotype from phenotype.

1. deriveButterfly(id: string): ButterflySpec
   Pure, deterministic, no canvas, no DOM, no side effects. Given an id it returns a
   plain data structure fully describing that butterfly: wing panel outlines, fold
   positions, cut shapes, punched holes, size, asymmetry offsets, all of it. The id is
   the only input — not the text, not the date, not the category, not the colour. Fixing
   a typo in an entry must produce a byte-identical creature.

2. renderButterfly(ctx, spec, palette, x, y, scale)
   Draws a spec. Knows nothing about ids.

Keeping these apart means step 7 can animate a spec, step 16 can turn the same spec into
a fold diagram, and the seed invariant becomes testable as plain data with no canvas shim.

Add vitest, and two tests operating on ButterflySpec only:
- the same id yields deeply equal specs across calls
- twenty different ids yield twenty distinct specs

The look:
- It must read as folded and cut paper. A visible mountain fold down the body axis, two
  wing panels per side meeting at that fold, and a scissor-cut silhouette carrying the
  small irregularities of hand cutting. The two sides are near-mirrored but never
  exactly — derive the asymmetry from the seed.
- Paper thickness: a thin lighter edge along cut boundaries, a darker crease along the
  fold, so the sheet has body.
- Pattern is cut shapes and punched holes, not painted markings. Papel picado and Polish
  wycinanki are the references. Wing scales and photorealism are not.
- A soft cast shadow onto the sheet below, offset consistently with PAPER.light.angleDeg
  so it agrees with the diorama's lighting.
- Twenty ids must look clearly distinct from each other and clearly like the same
  family. If they all look alike the seed isn't reaching enough parameters; if they look
  unrelated it is reaching too many.

Colour:
- Define CATEGORY_PAPERS: the eight papers from CLAUDE.md (season, heavens, earth,
  humanity, observances, animals, plants, muki). Dyed-paper colours, warm and muted
  enough to sit on the cream sheet without shouting. Propose them; I will tune.
- Colour comes from the category, geometry comes from the id. Changing an entry's
  category must recolour a butterfly without altering its shape at all.

Constraints:
- Canvas 2D. No images, no assets, no CSS filters.
- Each butterfly's static art rendered once into an offscreen canvas, cached by
  spec + palette + scale, because step 7 will draw many per frame.
- All tunables in an exported BUTTERFLY config object, matching how PAPER works.
- No motion, no wing flapping in this step.

Debug view, on a keypress:
- Tile twenty butterflies from twenty hardcoded ids across the sheet, cycling categories
  so I can see every paper.
- Show each at three scales — roughly 60px, 30px and 14px wingspan — because they will
  eventually sit on different depth planes, and procedural art that only reads at full
  size is useless. If the small one turns to mush, simplify until it doesn't.
```

**Verify:** restart and confirm the same twenty creatures appear identically. At 60px, distinct but related. At 14px, clean silhouettes rather than mush — that row is the one that matters, because half the swarm will live at that size.

---

## Prompt 6b — The gallery window fix

**Model:** Sonnet 5 · **Effort:** high

The gallery drew into a 420×300 window because `setSize` failed silently on a missing capability, and the `catch` blamed the browser.

```
The butterfly gallery never resizes the window — pressing `b` leaves it at 420x300 and
draws the gallery into a postcard.

1. src-tauri/capabilities/default.json is missing the window permissions that
   toggleGallery needs: setSize, setResizable and innerSize. Add them.

2. The try/catch in toggleGallery swallows the failure and blames "no Tauri window".
   That hid a permissions error behind a plausible excuse. Log the actual error, and
   after setSize read innerSize back and warn if it does not match what was requested.
   A silent no-op is the worst possible outcome here.

3. Show the current window size in the F9 overlay so this class of failure is visible
   the moment it happens rather than inferred from a screenshot.

4. Once the window really is 880x420, check the gallery layout end to end: all three
   bands must fit inside the sheet with nothing drawn into the transparent margin
   outside the box.
```

---

## Prompt 7 — Flight and the tuning panel

**Model:** Opus 5 · **Effort:** xhigh

```
Read CLAUDE.md first. New session. Steps 1, 1b, 2 and 6 are built and committed.

PART A — two small fixes first.

1. `muki` in papers.ts is undyed flax on a cream sheet, and it nearly disappears. It is
   one of eight categories, not an edge case. Darken or cool it until it holds its own
   against the paper without becoming a different colour family.

2. renderButterfly reads DPR from ctx.getTransform().a. That is about to break: motion
   will apply transforms, and .a will stop being the DPR. Pass it explicitly.

PART B — flight.

Read this part before writing anything, because it changes the render architecture.

The wings must rotate about the fold line, so a butterfly's silhouette genuinely narrows
and widens through the beat. Do not fake it by scaling. That means a butterfly is no
longer one static tile — the current buildTile cache assumes a fixed image.

Solve it as a sprite sheet, not by drawing live: quantise the wingbeat into a fixed
number of phases (start around 12) and pre-render one tile per phase, per spec, per
palette, per scale. Raise BUTTERFLY.cacheSize accordingly and key on the phase index.
Drawing the full tile — texture, bevel, cut edges, shadow — live for forty butterflies
every frame will not hold 60fps, and discovering that at step 8 is expensive.

While each panel has an angle, shade it by that angle against PAPER.light. This is what
finally makes them read as folded paper rather than as flat cutouts.

The motion model:
- Independent wing-beat phase and frequency per butterfly, so the swarm never pulses in
  unison. Unison is the single most artificial-looking failure mode available.
- Wandering flight from smooth pseudo-random drift, with occasional short glides where
  the wings hold open, and occasional direction changes that read as decisions rather
  than as noise.
- A gentle vertical bob coupled to the wing beat but slightly out of phase with it.
- Soft repulsion from the sheet's edges, so nothing clips the frame or parks in a corner.
- Weak mutual avoidance so they do not overlap unpleasantly. Explicitly NOT flocking.
  These are separate memories, not a school of fish.
- A configurable fraction at rest at any moment: settled on the sheet, wings still,
  waking occasionally and taking off, while others land. Forty butterflies all beating
  at once is exhausting to sit next to for eight hours, and this widget has to be
  liveable, not impressive.

Butterflies fly within the sheet area, not the whole window. Use the twenty gallery ids,
duplicated to forty for the performance test. No depth planes yet — keep them all at one
scale for now.

The tuning panel. This is the actual deliverable of the step, because I tune this by
dragging, not by prompting you:
- Toggled by a keypress. Live sliders for every motion constant — beat frequency and its
  spread, drift speed and scale, glide frequency, bob amplitude and phase offset, edge
  repulsion, avoidance strength, resting fraction, wake rate.
- Changes apply instantly, with no restart and no butterflies teleporting.
- A "copy config" button that dumps the current values as JSON I can paste straight back
  into the config object.
- The panel is a DOM overlay and will not fit in a 420x300 window, so tuning mode grows
  the window the same way the gallery does. Generalise that resize helper so both modes
  share it rather than duplicating it, and keep the size read-back check.

Constraints:
- 60fps with forty butterflies on integrated graphics. Show it in the F9 overlay.
- Keep the cadence rules from step 1b intact.
- The gallery on `b` must still work.
```

**Verify:** tune with two failure modes in mind — unison wingbeats, and paths that look like rails. Then leave it at 420×300 in a corner and click away into real work; the test is whether you glance over with pleasure or start finding it busy.

---

# Phase 3 — The plumbing

## Prompts 3 + 4 — The saijiki calendar and the kigo store

**Model:** Opus 5 · **Effort:** xhigh

Merged, because both end in green tests rather than in something to look at, and `season` is a field in the kigo frontmatter.

```
Read CLAUDE.md first — "The model" and "Storage and privacy" especially. New session.

This slice deliberately ends in green tests rather than in something to look at. Do not
wire any of it into the UI — step 5 does that. Do not create the real store as a side
effect of anything here.

PART A — the saijiki calendar, in src/seasons.ts.

Pure functions. No I/O, no side effects, and no clock inside them — every function takes
the date as a parameter.

- seasonOf(date) -> { season, division, bucketId }
  Traditional haiku boundaries from CLAUDE.md, not Western ones: spring Feb 4 - May 5,
  summer May 6 - Aug 7, autumn Aug 8 - Nov 6, winter Nov 7 - Feb 3. Divisions are
  early / middle / late, roughly 30 days each. New Year (Jan 1-7) is its own division
  carved out of winter, not a part of it.
- The season year runs Feb 4 to Feb 3, so winter crosses the calendar year and a January
  date belongs to the season year that began the previous February. This is the trap in
  this module. Make it explicit in the code and hammer it in the tests.
- orderedBuckets() -> the buckets in chronological order within a season year.
- seasonsSince(from, to) -> integer count of season boundaries crossed.
- saturationFor(seasonsSince) -> the fading curve from CLAUDE.md, hard floor at 40%.

Tests: every boundary date and the day either side of it; the New Year carve-out and both
its edges; Jan 5 resolving into the previous season year; leap years; and the whole
saturation curve including the floor and values beyond it.

PART B — the kigo store.

The format is a promise, not an implementation detail. It is what the user's diary lives
in for twenty years, so get it right now.

Split it so the disk is Rust's problem and the format is TypeScript's:

- Define a narrow KigoIO interface with exactly four operations: list(), read(path),
  writeAtomic(path, contents), remove(path).
- Implement it in Rust behind Tauri commands. The Rust side resolves the store root —
  %APPDATA%\saijiki on Windows and the documented equivalents elsewhere, switching to
  saijiki-dev when SAIJIKI_STORE=dev — and rejects any path that resolves outside that
  root. The frontend must never receive general filesystem access; scope the capability
  to these commands only.
- writeAtomic writes a temp file in the same directory and renames over the target.
- Implement KigoIO a second time in memory, for tests.

Everything else lives in TypeScript and is tested against the in-memory implementation,
so the suite needs no temp directories and no filesystem at all:

- Parse and serialise the markdown-with-frontmatter format exactly as specified in
  CLAUDE.md. Round-tripping must be lossless, and an unknown frontmatter key must be
  preserved rather than dropped.
- create / read / update / touch operations over kigo/*.md.
- id generation: short, collision-resistant, and immutable once assigned. The filename is
  derived from the date and a slug of the text and may change when the text is edited;
  the id may never change. Add a test that renaming a file does not change its id, and
  one that editing text does not either.
- index.json is a derived cache only. It must rebuild completely by scanning kigo/, and
  everything must work correctly if it is deleted at any moment. Test that path.
- Honour the schema field with a migration hook, even though there is only version 1.
- Hand-write one or two fixture files as literal strings in the tests, including a
  slightly messy one — trailing whitespace, an out-of-order key, a missing optional
  field — so the parser is pinned against real-world scruffiness.

Nothing in this step may read or write the user's real store.
```

---

## Prompt 5 — The dev harness, wired

**Model:** Opus 5 · **Effort:** xhigh

Absorbed the fading half of step 10: 150 seeded entries tell you nothing if they all render at full colour.

```
Read CLAUDE.md first — "The model", "Storage and privacy", and the fading table. New
session. The store is fully tested against an in-memory KigoIO but has never yet written
a file.

PART A — one gap from the last step.

resolve() in src-tauri/src/store.rs is the path-traversal guard, and it is the one
function here where a bug is a security bug. It has no test. Add cargo tests: "..", "..\",
an absolute path, a Windows drive path, "a/../../b", "foo:stream", an empty string, a
control character, and a couple of legitimate paths that must be accepted.

PART B — the seeder.

It writes to the dev store and nowhere else. Resolve the root first and throw if it is
not the dev one — a guard that reads the path, not one that trusts an env var was set.

- 150 synthetic kigo spread across three years, clustered the way a life is: some
  buckets with three entries, several with none, none with twelve.
- Vary category across all eight, verse count from zero to six, and touch history in
  roughly three groups — touched within the current season, one or two seasons stale,
  and untouched for over a year. Without that spread the fading curve is invisible.
- The text must be obviously synthetic. Do not write anything that reads like a real
  person's diary; this data will end up in screenshots.
- `npm run seed` and `npm run seed:clear`.

PART C — the time scrubber.

The app's notion of "today" comes from one injectable clock, so the whole UI can render
as of any date. Expose it as a dev keyboard control and a CLI flag. Nothing outside that
clock may call new Date() or Date.now() — grep for it and fix what you find.

PART D — wire the store into the swarm.

- On start, load every kigo from the store. One butterfly per entry: geometry from its
  id, colour from its category. FLIGHT.count stops being a constant.
- Apply the fading curve. It is already written and tested in seasons.ts — use
  saturationFor(seasonsSince(lastTouch, today)) and desaturate the palette by it. Do not
  redesign the curve. Keep it to the five discrete levels so the palette key stays a
  small set and the tile cache does not explode.
- Scrubbing time forward must visibly drain colour out of the swarm, and scrubbing back
  must restore it. That is the whole point of this step.
- With an empty store and no dev flag, the widget must show the empty state from step 2:
  the pristine sheet, no butterflies, and nothing apologising for being empty.

PART E — instrument the cache before it bites.

150 entries times 14 poses is about 2100 tiles against a cache of 2048, and step 8
multiplies it by the number of depth planes. Do not solve it yet. Measure it: add live
tile count, cache capacity, eviction count and rough tile memory in MB to the F9 overlay.

Do not touch the real store at any point.
```

---

# Phase 4 — The picture

## Prompt 8 — Depth planes and bucket clustering

**Model:** Opus 5 · **Effort:** xhigh

Next. See the prompt in the session where it was issued, or below once run.

---

## Still to write

Each depends on what the step before it looks like on screen.

| # | Step | Model | Effort |
| --- | --- | --- | --- |
| 9 | Landing and opening — a butterfly comes to the cursor, settles, opens its wings, and the entry text appears on the inner wing surface in a handwriting face. | Opus 5 | xhigh |
| 10 | The touch bloom — colour returning on a touch, and the crisp-and-pale versus soft-and-worn texture treatment. | Sonnet 5 | high |
| 11 | The add ceremony — scissors, blank slip, typing, paper choice, the cut from the back sheet, the fold into a chrysalis. The emotional peak; expect to iterate. | Opus 5 | xhigh |
| 12 | Emergence — a chrysalis unfolds on the first open of a later day. | Sonnet 5 | high |
| 13 | Holes in the back sheet — each cut leaves a permanent silhouette; the sheet accumulates them forever. | Opus 5 | high |
| 14 | Verses — adding one line to an open butterfly, and more writing appearing on the wings over time. | Sonnet 5 | medium |
| 15 | Anniversaries — on the day, that butterfly flies to the front of the box and stays there. No badge, no popup. | Sonnet 5 | medium |
| 16 | The field guide — every kigo rendered as an origami fold diagram, and the compact kiyose view. | Opus 5 | xhigh |
| 17 | The New Year poster — the back sheet exported printable at high resolution. | Sonnet 5 | high |
| 18 | Microcopy and README — every string checked against the non-negotiables for anything that sounds like an obligation. | Fable 5 | high |

**Parked decisions**, to settle before or during the animation pass at the end:

- Whether a faded butterfly should go grey (what the saturation table says) or pale and warm (what "sun-bleached" implies). **Now three treatments on the `f` key** — `chroma`, `bleach`, `sheltered` — named in the F9 overlay. Still to choose; the two that lose get deleted.
- ~~Slowing the wingbeat when unfocused, so 10fps reads as calm rather than as steppy.~~ Settled: `beat.calm` multiplies `hz` while the loop is throttled, eased over `beat.calmSec`. The sprite sheet is untouched — same phases, advanced more slowly.
- Which paper variant wins — `PAPER.active`, currently `0`.
- ~~The tile cache strategy once scale stops being constant.~~ Settled by depth planes: scale takes one of five values, and the visit walks a quantised ladder to a sixth. Wear was the last thing that could have reopened it and does not — a butterfly has one palette at a time, so the palette space can grow without the tile working set moving.
- ~~`bundle.active` is `false`, so no installer exists yet.~~ Settled: NSIS, current-user install, unsigned. See **Shipping** in CLAUDE.md.

---

## A standing instruction worth repeating in any session

> This repository is public and the user's entries are a private diary. Never read, print, or commit the real store. Use the dev store. Do not run git commands.

Sources for the model and effort details: [Claude Code model configuration](https://support.claude.com/en/articles/11940350-claude-code-model-configuration) · [Thinking and effort levels](https://getclaudekit.com/blog/guide/mechanics/thinking-and-effort-levels)
