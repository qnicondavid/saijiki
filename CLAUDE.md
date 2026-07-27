# saijiki

歳時記 · an almanac of small good things.

A desktop widget for recording a good thing you have started doing in your life. Entries are rare, not daily. Each one becomes a cut-paper butterfly in a postcard-sized paper diorama that sits in a corner of your screen.

This file is the design constitution. **Read it before changing anything.** Every rule below was argued for at length. If a change appears to require breaking one, stop and ask.

---

## Non-negotiables

These exist because this app is about beginnings, not obligations. Each one guards against it turning into a chore.

1. **No streaks, counters, or chains.** Never display a number of days. Duration is expressed as visual weight — brightness, size, texture — never as a figure that can be lost.
2. **Nothing dies.** No butterfly ever falls, greys out, disappears, or is removed by the passage of time. Neglect renders as sun-bleaching, never as death.
3. **No red, no warnings, no badges, no notifications.** Not for anything, ever.
4. **Skipped time is not a failure state.** There is no daily slot, no grid, nothing that can be empty in an accusing way.
5. **One verb: touch.** Touching a butterfly means *still true*. It opens the wings, reveals the text, restores full colour, and optionally accepts one new verse. There is no other interaction model — no checklists, no separate habit screen.
6. **Additions are rare and ceremonial.** The widget must be beautiful with zero, one, and three entries. That is the first several months of real use, not a state to rush past.
7. **Nothing changes day to day.** Fading is seasonal. Opening the widget three days running must show no visible delta. There is nothing to check.

---

## The model

An entry is a **kigo** (season word). The collection is the **saijiki**.

### Seasons

Traditional Japanese haiku calendar, **not** the Western one:

| Season | Range |
| --- | --- |
| Spring | Feb 4 – May 5 |
| Summer | May 6 – Aug 7 |
| Autumn | Aug 8 – Nov 6 |
| Winter | Nov 7 – Feb 3 |
| New Year | Jan 1 – Jan 7 — its own division, carved out of winter |

Each season splits into **early / middle / late**, roughly 30 days each. Four seasons of three divisions is twelve buckets, plus New Year makes **thirteen**. Buckets are also the depth-clustering unit for rendering: kigo from the same bucket share a depth plane.

Note the **season year** runs Feb 4 → Feb 3, so winter crosses the calendar year. January dates belong to the season year that began the previous February.

### Categories

The saijiki's own seven, used as paper stock: `season`, `heavens`, `earth`, `humanity`, `observances`, `animals`, `plants` — plus `muki` (seasonless) for one-time life changes that do not recur.

### Fading

Seasonal, never daily:

| Seasons since last touch | Saturation |
| --- | --- |
| 0 (current) | 100% |
| 1 | 85% |
| 2 | 65% |
| 3 | 50% |
| 4+ | 40% — hard floor, never lower |

A touch restores 100% with a small bloom.

---

## Ceremonies

Four moments carry the emotional weight of the app. Everything else is scaffolding around them.

**Recording.** Rare and deliberate. Click the scissors, a blank slip appears, write one line, pick a paper. On confirm the slip is **cut out of the back sheet** — leaving its silhouette behind as a permanent hole — folds itself into a flat square, and settles at the bottom of the box.

**Emergence.** The folded square stays a square until the widget is next opened on a **later day**. Then it unfolds into a butterfly. This is the only thing in the app that ever asks the user to return, and it asks by promising rather than demanding. Never notify about it. Never expire it — however long they take, the birth is waiting.

**Touching.** A butterfly comes to the cursor, lands, and opens its wings to show the text written on their inner surface. Colour returns to full with a small bloom. Optionally, one verse may be added.

**Anniversaries.** On the anniversary of a kigo, that butterfly flies to the front of the box and stays there for the day — nearer and larger, unmissable at a glance, entirely absent if the user never looks. No badge, no popup, no ribbon, no "1 year!".

**The field guide** (a later phase) renders every kigo as an origami fold diagram: numbered steps, dotted valley and mountain folds, the finished creature in the last panel. The compact version without verses is the **kiyose**. Printed, the back sheet with its accumulated holes is the year-end poster — no separate artefact needs designing.

---

## Storage and privacy

> **This repository is public. The user's entries are a private diary. They must never enter the repo.**

- Real data lives in the OS app-data directory, **never** in the project folder:
  - Windows `%APPDATA%\saijiki\`
  - macOS `~/Library/Application Support/saijiki/`
  - Linux `~/.local/share/saijiki/`
- The synthetic dev store is separate: same locations, but `saijiki-dev`.
- **Never read, print, copy, or commit the real store.** Debug against the dev store. If you believe you need the real one, stop and ask.
- Never commit fixtures, screenshots, or GIFs derived from real entries. All demo material comes from the synthetic seeder.
- `.gitignore` is a backstop, not the defence. The defence is that data never lives here.

### Format

One markdown file per kigo, plus a rebuildable index:

```
%APPDATA%\saijiki\
  kigo\
    2026-02-11-kitchen-phone.md
  index.json          ← derived cache; disposable, rebuildable from kigo/
```

```markdown
---
schema: 1
id: k_7f3a9c                 # immutable forever
created: 2026-02-11
season: spring/early
category: humanity
paper: "#c94f3d"
touched: [2026-02-19, 2026-03-02]
---
# leaving my phone in the kitchen at dinner

- still doing it, and dinner is longer now (2026-03-02)
```

Plain markdown is a promise, not an implementation detail. The data must stay readable and editable in any text editor, with no software at all, in twenty years.

### The seed rule

A butterfly's entire appearance derives from `id` and nothing else. `id` is immutable. Text, category, and paper are editable and **must never** alter wing geometry or pattern — fixing a typo must not change the creature. This is the single most expensive bug available in this codebase.

---

## Visual voice

Cut paper and origami. Not watercolour, not flat vector, not wellness-app pastel.

- Depth is **layered paper casting shadows**, like a tunnel book — never gaussian blur or depth-of-field.
- Every surface has grain, fibre, and a scissor-cut or deckled edge.
- The back wall of the diorama is a single sheet of paper. Every butterfly is cut **from it**, and its silhouette stays behind as a hole. The sheet accumulates holes forever; printed, it is the year-end poster.
- Untouched entries go **crisp but pale** (sun-bleached). Touched entries go **soft but vivid** (worn at the folds from handling). Wear signifies affection, not damage.
- Text lives on the **inner** surface of the wings — invisible in flight, readable only when a butterfly lands and opens.
- Sound, if any, is paper only: fold, flutter, page turn. Quiet. Never musical, never chimed.

---

## Technical

- **Tauri v2**, TypeScript, Vite. **Canvas 2D**, not WebGL, until profiling proves otherwise.
- Window: frameless, transparent, always-on-top, draggable, ~420×300, parked in a screen corner. Not fullscreen, not wallpaper-level.
- Fully local. No network calls, no accounts, no telemetry, no analytics, ever.
- **It runs all day, and it must stay alive while the user works.** Never stop rendering merely because the window is unfocused — an always-on-top ambient widget is looked at *precisely* when something else has focus. Stop completely only when the window is genuinely hidden, minimised, or occluded. Visible but unfocused: throttle to roughly 10fps. On battery: throttle further, never freeze.
- **Window dragging must never swallow a touch.** The whole surface is draggable, but `touch` is the app's only verb and must always win. Dragging begins only after the pointer moves past a small threshold, and never when the press began on a butterfly. A press and release without movement is a click, not a drag.
- All animation constants live in one config object exposed to the dev slider panel. Tune by dragging, then bake the values in.

### The dev harness

The app's notion of "today" comes from one injectable clock (`src/clock.ts`). **Nothing else may call `new Date()` or `Date.now()`** — `clock.test.ts` reads the source and fails if anything does. A stray one does not break a test, it quietly makes half the UI un-scrubbable, and the symptom looks like a bug in the fading curve.

```
npm run seed                        150 synthetic kigo in the dev store
npm run seed -- --today=2029-03-01  ...as of another day
npm run seed:clear                  take them out again
npm run dev:store                   run the widget against the dev store
npm run dev:store -- --today=…      run it as of any date
```

The seeder resolves the store root and refuses anything not named `saijiki-dev`, by reading the path rather than trusting that a flag was passed.

In the app: `F9` overlay, `v` paper variant, `b` gallery, `t` tuning panel, `[`/`]` a day, `{`/`}` a season, `\` back to the real today. Seasons are the ones worth pressing — fading is seasonal, so a day shows nothing and a season visibly drains the colour out of the swarm.

---

## Working agreements

- **Every slice must end in something visible.** If a change can't be judged by looking at the widget, add a way to look at it.
- The synthetic seeder and time-scrubber exist so year-three state can be inspected on day one. Use them.
- Do not run `git push`, `git pull`, or `git commit` unless explicitly asked. The user drives git.
- When a design question arises that this file doesn't answer, ask rather than decide. The answer is usually *whichever option creates less obligation*.
