// The parts of flight that are load-bearing and invisible.
//
// Most of this step is judged by eye and can only be judged by eye. These are
// the exceptions: claims that are either true or false, that a screenshot will
// not settle, and that would each fail in a way easily mistaken for "the motion
// needs more tuning".

import { afterEach, describe, expect, it } from "vitest";
import {
  FLIGHT,
  beatRate,
  crossed,
  flightBounds,
  flyerCount,
  poseTable,
  restingCount,
  setBeatCalm,
  setSwarm,
  stepFlight,
  swarmDepth,
  swarmFade,
  swarmPapers,
  swarmWear,
  swarmWorkingSet,
  type SwarmEntry,
} from "./flight";
import { RENDER_CONFIG } from "./render-loop";
import { projectOnFold } from "./butterfly-render";
import { BUTTERFLY } from "./butterfly";
import { sheetRect } from "./paper";
import { planeCount, planeOf, planeTable } from "./planes";
import { planSeed } from "./seed-plan";
import { bucketsSince } from "./seasons";
import { TUNING_PANEL_INSET, TUNING_PANEL_WIDTH, TUNING_SIZE } from "./tuning-panel";

const TIP = { x: 0.5, y: 0.3 };

// A kigo begun on `created` and, unless it says otherwise, last known true on
// the same day and never picked up. The three are separate arguments because
// they drive three separate channels — `created` sets the depth plane and never
// moves, `since` sets the fade and moves on every touch, and `touches` sets the
// wear and only ever goes up.
const entry = (id: string, created: string, since = created, touches = 0): SwarmEntry => ({
  id,
  category: "humanity",
  created,
  since,
  touches,
});

describe("wing projection", () => {
  // The whole point of the step. If this ever becomes a pure x-scale, the
  // silhouette still narrows and the bug is invisible in a still frame.
  it("is not an x-scale: lifting a wing magnifies it in y as well", () => {
    const flat = projectOnFold(TIP, 0, FLIGHT.beat.camera);
    const lifted = projectOnFold(TIP, Math.PI / 4, FLIGHT.beat.camera);
    expect(flat.y).toBeCloseTo(TIP.y, 6);
    expect(lifted.y).toBeGreaterThan(flat.y * 1.02);
  });

  it("narrows the silhouette as the wing turns away from the plane", () => {
    const flat = Math.abs(projectOnFold(TIP, 0, FLIGHT.beat.camera).x);
    const lifted = Math.abs(projectOnFold(TIP, Math.PI / 3, FLIGHT.beat.camera).x);
    expect(lifted).toBeLessThan(flat * 0.75);
  });

  it("leaves the fold itself exactly where it is", () => {
    for (const theta of [-1, -0.3, 0, 0.4, 1.2]) {
      const p = projectOnFold({ x: 0, y: 0.42 }, theta, FLIGHT.beat.camera);
      expect(p.x).toBeCloseTo(0, 10);
      expect(p.y).toBeCloseTo(0.42, 10);
    }
  });

  it("pushes a wing pressed toward the sheet further away, not nearer", () => {
    const back = projectOnFold(TIP, -Math.PI / 4, FLIGHT.beat.camera);
    const forward = projectOnFold(TIP, Math.PI / 4, FLIGHT.beat.camera);
    expect(back.y).toBeLessThan(TIP.y);
    expect(forward.y).toBeGreaterThan(TIP.y);
  });
});

describe("the wingbeat", () => {
  const table = poseTable();

  it("quantises to the configured number of phases", () => {
    expect(table.beat.length).toBe(FLIGHT.beat.phases);
  });

  it("gives every phase its own pose", () => {
    const seen = new Set(table.beat.map((p) => `${p.fore.toFixed(5)}|${p.hind.toFixed(5)}`));
    expect(seen.size).toBe(table.beat.length);
  });

  // Silhouette width goes as cos(theta), and it has to actually move. A beat
  // that stayed within a few degrees of flat would be a very expensive way to
  // draw a still butterfly.
  it("swings the silhouette through a wide range", () => {
    const widths = table.beat.map((p) => Math.abs(Math.cos(p.fore)));
    expect(Math.max(...widths) - Math.min(...widths)).toBeGreaterThan(0.4);
  });

  // The forewing and hindwing lying in the same plane is the tell that turns a
  // butterfly back into a folded card. They beat at different depths and the
  // hind trails, so they should essentially never agree.
  it("keeps the hindwing out of the forewing's plane", () => {
    const together = table.beat.filter((p) => Math.abs(p.fore - p.hind) < 0.02);
    expect(together.length).toBeLessThanOrEqual(1);
  });

  it("beats the hindwing shallower than the forewing", () => {
    const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    expect(spread(table.beat.map((p) => p.hind))).toBeLessThan(
      spread(table.beat.map((p) => p.fore)),
    );
  });

  it("holds the glide open and the rest pose back", () => {
    expect(table.glide.fore).toBeGreaterThan(table.rest.fore);
    // rest is the shallow mountain fold of a specimen: wings behind the plane
    expect(table.rest.fore).toBeLessThan(0);
  });

  // Asymmetry is what stops the beat reading as a metronome. Counting phases
  // above the mid-angle cannot see it — the phase warp pins both midpoint
  // crossings — so measure the thing that actually differs: how much of the
  // cycle the stroke spends going up versus coming back down.
  //
  // This pins the shipped skew, not the mechanism; skew: 0 is a legal setting
  // and would correctly make these equal.
  it("spends unequal time on the upstroke and the recovery", () => {
    const n = table.beat.length;
    let hi = 0;
    let lo = 0;
    table.beat.forEach((p, i) => {
      if (p.fore > table.beat[hi].fore) hi = i;
      if (p.fore < table.beat[lo].fore) lo = i;
    });
    const rising = (hi - lo + n) % n;
    const falling = (lo - hi + n) % n;
    expect(rising).not.toBe(falling);
    expect(Math.abs(rising - falling)).toBeGreaterThanOrEqual(2);
  });
});

describe("the drowsy beat", () => {
  // The widget is unfocused nearly all the time it exists, and unfocused is ten
  // frames a second. What is pinned here is that slowing the beat is a *phase*
  // change and not a *pose* change — the sprite sheet must be untouched, or the
  // fix for a stutter would be a cache rebuild on every alt-tab.
  const bounds = flightBounds(420, 300);

  const settleCalm = (throttled: boolean) => {
    setBeatCalm(throttled);
    // An exponential is most of the way there in three time constants and never
    // actually arrives, so this waits for the *snap* rather than for the ease:
    // about ten seconds at a 1.6s constant. Everything visible happened in the
    // first two.
    for (let i = 0; i < 60 * 12; i++) stepFlight(1 / 60, i / 60, bounds);
  };

  afterEach(() => settleCalm(false));

  it("does not touch the pose table, which is what the tiles are built from", () => {
    const awake = JSON.stringify(poseTable());
    settleCalm(true);
    expect(JSON.stringify(poseTable())).toBe(awake);
    // and for the same reason `hz` has never been a rebuild knob: nothing in
    // the table reads it
    const hz = FLIGHT.beat.hz;
    try {
      FLIGHT.beat.hz = hz * 3;
      expect(JSON.stringify(poseTable())).toBe(awake);
    } finally {
      FLIGHT.beat.hz = hz;
    }
  });

  it("slows to the calm rate and comes back", () => {
    expect(beatRate().hz).toBeCloseTo(FLIGHT.beat.hz, 5);
    settleCalm(true);
    expect(beatRate().hz).toBeCloseTo(FLIGHT.beat.hz * FLIGHT.beat.calm, 2);
    settleCalm(false);
    expect(beatRate().hz).toBeCloseTo(FLIGHT.beat.hz, 2);
  });

  it("eases across the change rather than snapping", () => {
    // The whole point of `calmSec`. A rate that jumped would be a visible lurch
    // across the entire box at the exact moment someone clicked away from it.
    setBeatCalm(true);
    stepFlight(1 / 60, 0, bounds);
    expect(beatRate().calm).toBeLessThan(0.05);
    for (let i = 0; i < 30; i++) stepFlight(1 / 60, i / 60, bounds);
    const half = beatRate().calm;
    expect(half).toBeGreaterThan(0.05);
    expect(half).toBeLessThan(0.95);
  });

  it("leaves the fastest butterfly enough frames to read as a wingbeat", () => {
    // The measurement the whole thing exists for. `hzSpread` is per-creature,
    // so the number that has to survive is the *fastest* one in the swarm, not
    // the average — and at four samples a beat a wingbeat does not read as slow,
    // it reads as broken.
    const fastest = (rate: number) => rate * (1 + FLIGHT.beat.hzSpread);
    const samples = (rate: number) => RENDER_CONFIG.unfocusedFps / fastest(rate);
    expect(samples(FLIGHT.beat.hz), "awake, at the unfocused cadence").toBeLessThan(4);
    settleCalm(true);
    expect(samples(beatRate().hz), "drowsy, at the unfocused cadence").toBeGreaterThan(7);
  });
});

describe("crossing the glide entry", () => {
  it("catches a crossing inside a frame", () => {
    expect(crossed(0.2, 0.4, 0.3)).toBe(true);
    expect(crossed(0.2, 0.4, 0.5)).toBe(false);
  });

  // The case that matters at 10fps, where a frame can swallow most of a beat.
  it("catches a crossing that wraps past the end of the cycle", () => {
    expect(crossed(0.9, 0.1, 0.95)).toBe(true);
    expect(crossed(0.9, 0.1, 0.05)).toBe(true);
    expect(crossed(0.9, 0.1, 0.5)).toBe(false);
  });
});

describe("the swarm is the saijiki", () => {
  // stepFlight with dt = 0 reconciles the population and returns without
  // simulating anything, which is the whole of what these need — no canvas, no
  // clock, no frame.
  const bounds = flightBounds(420, 300);
  const settle = () => stepFlight(0, 0, bounds);

  // A kigo begun on `created` and, unless it says otherwise, last known true on
  // the same day. The two dates are separate arguments because they drive
  // separate channels — `created` sets depth and never moves, `since` sets the
  // fade and moves on every touch.
  it("shows nothing at all for an empty store", () => {
    // The empty state is the pristine sheet from step 2, and it has to be
    // lovely on its own — there is no filler creature and no demo swarm.
    setSwarm([], "2026-07-27");
    settle();
    expect(flyerCount()).toBe(0);
  });

  it("puts exactly one butterfly in the air per kigo", () => {
    setSwarm([entry("k_000001", "2026-07-01"), entry("k_000002", "2026-07-02")], "2026-07-27");
    settle();
    expect(flyerCount()).toBe(2);
  });

  it("fades each one by CLAUDE.md's curve", () => {
    setSwarm(
      [
        entry("k_00000a", "2026-07-01"), // this season
        entry("k_00000b", "2026-04-01"), // one season back
        entry("k_00000c", "2026-01-01"), // two
        entry("k_00000d", "2025-10-01"), // three
        entry("k_00000e", "2023-01-01"), // long past the floor
      ],
      "2026-07-27",
    );
    settle();
    expect(swarmFade()).toEqual([1, 1, 1, 1, 1]);
  });

  it("drains colour as time is scrubbed forward, and restores it going back", () => {
    // The point of the whole step. Same entries, same swarm, later day.
    const saijiki = [
      entry("k_00000a", "2026-07-01"),
      entry("k_00000b", "2026-04-01"),
      entry("k_00000c", "2026-01-01"),
    ];
    setSwarm(saijiki, "2026-07-27");
    settle();
    expect(swarmFade()).toEqual([1, 1, 1, 0, 0]);

    setSwarm(saijiki, "2026-11-07"); // two seasons on
    settle();
    expect(swarmFade()).toEqual([0, 0, 1, 1, 1]);

    setSwarm(saijiki, "2026-07-27");
    settle();
    expect(swarmFade()).toEqual([1, 1, 1, 0, 0]);
  });

  it("never fades past the floor, however long a kigo is left", () => {
    // "Nothing dies." Neglect bleaches paper; it does not remove it.
    setSwarm([entry("k_00000f", "1998-03-04")], "2026-07-27");
    settle();
    expect(flyerCount()).toBe(1);
    expect(swarmFade()).toEqual([0, 0, 0, 0, 1]);
  });

  // Whether a scrub rebuilt the swarm is not directly observable without a
  // canvas — but sleep is. A flyer is born flying, and a third of them settle
  // over the first few seconds. If the count that is asleep survives a recolour,
  // the flyers survived it too; if the swarm had been rebuilt they would all be
  // back in the air and scattered, and the colour change would be invisible
  // against the movement.
  function flyForFifteenSeconds(): void {
    for (let i = 0; i < 900; i++) stepFlight(1 / 60, i / 60, bounds);
  }

  const twenty = Array.from({ length: 20 }, (_, i) =>
    entry(`k_1000${String(i).padStart(2, "0")}`, i % 2 === 0 ? "2026-07-01" : "2026-04-01"),
  );

  it("recolours in place rather than rebuilding the swarm", () => {
    setSwarm(twenty, "2026-07-27");
    settle();
    flyForFifteenSeconds();
    const asleep = restingCount();
    expect(asleep).toBeGreaterThan(0);
    expect(swarmFade()).toEqual([10, 10, 0, 0, 0]);

    setSwarm(twenty, "2027-02-04"); // three seasons on, into the next spring
    settle();
    expect(restingCount()).toBe(asleep);
    expect(flyerCount()).toBe(20);
    expect(swarmFade()).toEqual([0, 0, 0, 10, 10]);
  });

  it("keeps the butterflies that stayed and only replaces the one that left", () => {
    setSwarm(twenty, "2026-07-27");
    settle();
    flyForFifteenSeconds();
    const asleep = restingCount();

    const swapped = [...twenty.slice(0, 19), entry("k_1000ff", "2026-07-01")];
    setSwarm(swapped, "2026-07-27");
    settle();
    expect(flyerCount()).toBe(20);
    // the newcomer arrives flying; nobody else was disturbed
    expect(restingCount()).toBeGreaterThanOrEqual(asleep - 1);
    expect(restingCount()).toBeLessThanOrEqual(asleep);
  });
});

// Thirteen kigo, one begun in each of the thirteen buckets before this day —
// which is a season boundary, so that `}` from here is exactly three buckets
// and the whole swarm's recession can be read off in one step.
//
// The ages are asserted rather than assumed: the dates below were worked out by
// hand against the solar terms, and a fixture nobody checks is a fixture that
// quietly rots the day a boundary moves.
const ON_A_SEASON_BOUNDARY = "2026-08-08"; // 立秋, autumn/early opens
const A_SEASON_ON = "2026-11-07"; // 立冬, three buckets later

const ONE_PER_BUCKET: readonly string[] = [
  "2026-08-08", // 0 · autumn/early
  "2026-07-20", // 1 · summer/late
  "2026-06-20", // 2 · summer/middle
  "2026-05-20", // 3 · summer/early
  "2026-04-20", // 4 · spring/late
  "2026-03-20", // 5 · spring/middle
  "2026-02-20", // 6 · spring/early
  "2026-01-20", // 7 · winter/late
  "2026-01-03", // 8 · new-year
  "2025-12-20", // 9 · winter/middle
  "2025-11-20", // 10 · winter/early
  "2025-10-20", // 11 · autumn/late
  "2025-09-20", // 12 · autumn/middle
];

// The plane model itself — which age lands on which plane, and what each of
// them looks like — is planes.test.ts. These are the claims about the *swarm*
// on those planes, which need a box and a few seconds of flight.
describe("depth planes", () => {
  const bounds = flightBounds(420, 300);
  const settle = () => stepFlight(0, 0, bounds);
  // A plane change is an ease, not an assignment, so a test that wants to know
  // where the swarm ended up has to let it get there.
  const fly = (seconds: number) => {
    for (let i = 0, n = Math.round(seconds * 60); i < n; i++) stepFlight(1 / 60, i / 60, bounds);
  };

  const perBucket = (today: string): SwarmEntry[] =>
    ONE_PER_BUCKET.map((created, age) => {
      expect(bucketsSince(created, ONE_PER_BUCKET[0]), `${created} is not ${age} buckets back`).toBe(
        age,
      );
      return {
        id: `k_bucket${String(age).padStart(2, "0")}`,
        category: "humanity" as const,
        created,
        // Touched today, every one of them, exactly once. The fade and the wear
        // are therefore identical across the whole swarm and every difference
        // on screen is depth — which is the only way to look at one channel at
        // a time.
        since: today,
        touches: 1,
      };
    });

  it("never lets a touch move a butterfly in depth", () => {
    // The orthogonality claim, and the reason `created` and `since` are two
    // fields. Touching says *still true*, not *begun again*: it restores the
    // colour and leaves the creature exactly where it is in the box.
    const untouched = entry("k_dep001", "2024-03-01");
    const touched = entry("k_dep002", "2024-03-01", "2026-08-01");
    expect(planeOf(bucketsSince(untouched.created as string, ON_A_SEASON_BOUNDARY))).toBe(
      planeOf(bucketsSince(touched.created as string, ON_A_SEASON_BOUNDARY)),
    );

    setSwarm([untouched, touched], ON_A_SEASON_BOUNDARY);
    settle();
    // same plane, different amounts of colour left: far and vivid beside far
    // and pale, which is the pair the depth cue has to keep telling apart
    expect(swarmDepth().filter((n) => n > 0)).toEqual([2]);
    expect(swarmFade().filter((n) => n > 0)).toEqual([1, 1]);
  });

  it("steps the swarm back a plane as a season passes, and forward again", () => {
    // The proof the model is wired to the clock, and the thing to watch on the
    // F9 overlay's `depth:` line while holding `}`. One kigo per bucket, so the
    // whole distribution is visible: three at the glass, three behind them, six
    // behind those.
    setSwarm(perBucket(ON_A_SEASON_BOUNDARY), ON_A_SEASON_BOUNDARY);
    settle();
    expect(swarmDepth()).toEqual([3, 3, 6, 1, 0]);

    // `}` — one season, which is three buckets from a boundary. Everything
    // moves back, and the front plane empties because nothing new was begun.
    setSwarm(perBucket(A_SEASON_ON), A_SEASON_ON);
    fly(3);
    expect(swarmDepth()).toEqual([0, 3, 6, 4, 0]);

    // `{` — and back. Same butterflies, same box, brought forward again.
    setSwarm(perBucket(ON_A_SEASON_BOUNDARY), ON_A_SEASON_BOUNDARY);
    fly(3);
    expect(swarmDepth()).toEqual([3, 3, 6, 1, 0]);
  });

  it("brings a newly recorded kigo to the glass, and nobody else with it", () => {
    setSwarm(perBucket(A_SEASON_ON), A_SEASON_ON);
    fly(3);
    expect(swarmDepth()).toEqual([0, 3, 6, 4, 0]);

    const withNew = [
      ...perBucket(A_SEASON_ON),
      entry("k_dep0ff", A_SEASON_ON), // recorded today
    ];
    setSwarm(withNew, A_SEASON_ON);
    fly(1);
    expect(swarmDepth()).toEqual([1, 3, 6, 4, 0]);
  });

  it("travels between planes rather than jumping", () => {
    // Watchable, not a fancy transition — but it does have to be watchable. A
    // frame after the clock moves, the butterfly must still be drawn where it
    // was; a second later it must have arrived.
    setSwarm([entry("k_dep003", ONE_PER_BUCKET[0])], ON_A_SEASON_BOUNDARY);
    settle();
    expect(swarmDepth()[0]).toBe(1);

    setSwarm([entry("k_dep003", ONE_PER_BUCKET[0])], "2027-08-08"); // a year on
    stepFlight(1 / 60, 0, bounds);
    expect(swarmDepth()[0], "it jumped").toBe(1);
    fly(4);
    expect(swarmDepth()[0], "it never arrived").toBe(0);
    expect(swarmDepth()[3]).toBe(1);
  });
});

describe("colour and wear are two channels", () => {
  // The claim the second channel rests on, and one the eye cannot check: it is
  // a few pixels of edge treatment on a hundred and fifty small moving objects.
  //
  // Colour says how long since a kigo was last true; wear says how often it has
  // ever been picked up. Both are read off the same palette, so it would be very
  // easy for one to quietly become a function of the other — and the mixed cases
  // are the whole point. Far, faint and deeply worn is a different life from
  // near, faint and pristine.
  const bounds = flightBounds(420, 300);
  const settle = () => stepFlight(0, 0, bounds);

  // one per wear level, all begun and last-touched on the same days, so the fade
  // is identical across the four and the only thing differing is the handling
  const ladder: SwarmEntry[] = [0, 2, 4, 9].map((touches, i) =>
    entry(`k_wear${i}`, "2025-02-11", "2026-07-27", touches),
  );

  it("spreads across the wear levels without moving the fade", () => {
    setSwarm(ladder, "2026-07-27");
    settle();
    expect(swarmWear()).toEqual([1, 1, 1, 1]);
    expect(swarmFade()[0], "all four were touched today").toBe(4);
  });

  it("leaves wear exactly where it was when the clock moves", () => {
    setSwarm(ladder, "2026-07-27");
    settle();
    const before = swarmWear();
    // four seasons on: everyone is on the hard floor and nobody has been
    // handled any more than they were
    setSwarm(ladder, "2027-11-07");
    settle();
    expect(swarmFade()[0], "the fade did not move").toBe(0);
    expect(swarmFade()[4]).toBe(4);
    expect(swarmWear(), "scrubbing the clock aged the handling").toEqual(before);
  });

  it("costs no tiles, because a butterfly has one palette at a time", () => {
    // The reason wear is affordable at all, and the thing to re-measure if it
    // ever stops being a palette dimension. The tile key is spec + palette +
    // scale + dpr + phase + look, and the palette is *determined* by the
    // creature — so the working set is one sprite sheet per butterfly whatever
    // the palette space looks like. Wear multiplies the space by four and the
    // tiles by one.
    const today = "2026-07-27";
    const kigo = planSeed({ today }).kigo;
    const asStored = kigo.map((k) => ({
      id: k.id,
      category: k.category,
      created: k.created,
      since: k.touched[k.touched.length - 1] ?? k.created,
      touches: k.touched.length,
    }));
    const flattened = asStored.map((e) => ({ ...e, touches: 0 }));

    setSwarm(flattened, today);
    settle();
    const withoutWear = { tiles: swarmWorkingSet(), papers: swarmPapers() };

    setSwarm(asStored, today);
    settle();
    const withWear = { tiles: swarmWorkingSet(), papers: swarmPapers() };

    expect(withWear.tiles, "wear became a tile dimension").toBe(withoutWear.tiles);
    // it does cost palettes — small plain objects, and not what the cache holds
    expect(withWear.papers).toBeGreaterThan(withoutWear.papers);
    // ...and every one of the four levels is actually reached by a real store,
    // which is what makes the thresholds worth their spacing
    expect(swarmWear().every((n) => n > 0), `${swarmWear().join("·")}`).toBe(true);
  });
});

// A saijiki of a size someone might really have after a few years. Entries are
// rare, not daily — "the widget must be beautiful with zero, one, and three
// entries" — so this is the number the shipped app has to be comfortable at,
// and the seeded hundred and fifty is a stress case rather than a target.
const A_FULL_SAIJIKI = 40;

// What the seeder writes, and therefore what the dev store puts in the air.
const THE_SEEDED_STORE = 150;

describe("the tile cache", () => {
  // "A cache that cannot hold all of it holds none of it": every butterfly
  // cycles its whole phase set inside one wingbeat, so a cache one entry short
  // of the working set evicts the tile it is about to need, every frame,
  // forever.
  //
  // Until depth, the working set was one number — kigo times poses — and it had
  // quietly outgrown the cache at a hundred and fifty. Depth is what buys it
  // back, and not by making the tiles smaller: by putting the crowd on the
  // plane with the fewest wingbeat tiles. The far plane is where a saijiki
  // accumulates and it is the cheapest place in the box.
  //
  // So the arithmetic below is a sum over planes, and it is computed from the
  // *actual* seeded distribution rather than a number copied out of a console.
  // Change the seeder or drag a plane edge and this says what it did to the
  // cache.
  const depthPlan = (today: string): number[] => {
    const counts = new Array(planeCount()).fill(0);
    for (const kigo of planSeed({ today }).kigo) {
      counts[planeOf(bucketsSince(kigo.created, today))]++;
    }
    return counts;
  };

  const seeded = depthPlan("2026-07-27");
  const posesPerCreature = () => FLIGHT.beat.phases + 2; // beat, plus rest and glide

  it("puts the seeded dev store on every plane, with none left empty", () => {
    // Not a cache assertion so much as the assumption every cache assertion
    // below rests on — and the one that caught CLAUDE.md's one-bucket-per-plane
    // model, which measures 7 · 5 · 0 · 0 · 138 against three years of entries
    // and is a front and a back rather than a box.
    expect(seeded.reduce((a, b) => a + b, 0)).toBe(THE_SEEDED_STORE);
    for (const [p, n] of seeded.entries()) expect(n, `plane ${p} is empty`).toBeGreaterThan(0);
    // and the crowd is at the back, where it belongs and where it is cheapest
    expect(Math.max(...seeded)).toBe(seeded[seeded.length - 1]);
  });

  it("holds the whole seeded dev store at once, every plane, with room over", () => {
    const tiles = swarmWorkingSet(seeded);
    expect(tiles).toBeLessThan(BUTTERFLY.cacheSize);
    // comfortably, not by one tile: a scrub builds the planes a butterfly is
    // moving to before it has finished with the ones it is leaving, and that
    // transient has to fit too
    expect(tiles).toBeLessThan(BUTTERFLY.cacheSize * 0.8);
  });

  it("stays under capacity wherever the scrubber is left", () => {
    // One date is one date. The scrubber goes anywhere, and the distribution
    // slides rightwards the whole way — which is the good direction, because
    // the far planes are the cheap ones, but that is a claim worth checking
    // rather than assuming.
    const kigo = planSeed({ today: "2026-07-27" }).kigo;
    for (const today of ["2026-07-27", "2027-02-04", "2028-05-06", "2029-08-08", "2031-11-07"]) {
      const counts = new Array(planeCount()).fill(0);
      for (const k of kigo) counts[planeOf(bucketsSince(k.created, today))]++;
      const tiles = swarmWorkingSet(counts);
      expect(tiles, `${today} needs ${tiles} tiles`).toBeLessThan(BUTTERFLY.cacheSize * 0.8);
    }
  });

  it("would not hold that same store at one scale, which is why the planes exist", () => {
    // The measurement this step was built against. Before depth, every
    // butterfly drew at the full wingspan and the working set was flatly over
    // capacity — the cache pinned at its ceiling, evicting the tile it was
    // about to need, every frame, forever.
    expect(THE_SEEDED_STORE * posesPerCreature()).toBeGreaterThan(BUTTERFLY.cacheSize);
    expect(swarmWorkingSet(seeded)).toBeLessThan(THE_SEEDED_STORE * posesPerCreature());
  });

  it("spends the least per creature exactly where the crowd is", () => {
    const table = planeTable();
    const perCreature = table.map((p) => p.phases + 2);
    for (let i = 1; i < perCreature.length; i++) {
      expect(perCreature[i]).toBeLessThanOrEqual(perCreature[i - 1]);
    }
    // the back plane accumulates without limit, so it has to be the cheap one
    expect(perCreature[perCreature.length - 1]).toBeLessThan(perCreature[0]);
  });

  it("holds a saijiki of a realistic size wherever in the box it happens to be", () => {
    // Forty entries, worst case: every one of them recorded this bucket and
    // therefore all at the glass, at the full wingspan and the full phase
    // count. This is the case the planes cannot help with, and it still fits.
    expect(A_FULL_SAIJIKI * posesPerCreature()).toBeLessThanOrEqual(BUTTERFLY.cacheSize);
  });

  it("runs out sooner still when the panel raises the phase count", () => {
    // Unchanged and still true: the tuning panel can take the beat to
    // twenty-four phases, and nothing about depth makes the near plane cheaper.
    // A tripwire, not a promise — the panel is a dev tool and is allowed to
    // outspend the cache, as long as finding out is not an afternoon of jank.
    const maxPhases = 24;
    expect(Math.floor(BUTTERFLY.cacheSize / (maxPhases + 2))).toBeLessThan(A_FULL_SAIJIKI * 2.5);
  });
});

describe("tuning mode's window", () => {
  // The panel and the swarm share the window, and the swarm is kept out from
  // under the panel. If the borrowed window is too small the flight area
  // collapses to a sliver and the sliders are tuning something invisible.
  it("leaves a usable sheet beside the panel", () => {
    const sheet = sheetRect(TUNING_SIZE.width, TUNING_SIZE.height);
    const panelLeft = TUNING_SIZE.width - TUNING_PANEL_INSET - TUNING_PANEL_WIDTH;
    const reserved = Math.max(0, sheet.x + sheet.w - panelLeft + 8);
    const inset = FLIGHT.wingspan * 0.55 + 2;
    const w = sheet.w - inset * 2 - reserved;
    const h = sheet.h - inset * 2;
    expect(w).toBeGreaterThan(360);
    expect(h).toBeGreaterThan(360);
    // and enough room that a full saijiki at the default wingspan is not
    // shoulder to shoulder, which would make avoidance the only thing on show
    expect((w * h) / (A_FULL_SAIJIKI * FLIGHT.wingspan * FLIGHT.wingspan)).toBeGreaterThan(4);
  });
});
