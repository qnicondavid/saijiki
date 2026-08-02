// The parts of flight that are load-bearing and invisible.
//
// Most of this step is judged by eye and can only be judged by eye. These are
// the exceptions: claims that are either true or false, that a screenshot will
// not settle, and that would each fail in a way easily mistaken for "the motion
// needs more tuning".

import { describe, expect, it } from "vitest";
import {
  FLIGHT,
  clearCursor,
  crossed,
  endVisit,
  flightBounds,
  flyerCount,
  hitTest,
  nearest,
  poseTable,
  restingCount,
  setCursor,
  setSwarm,
  stepFlight,
  swarmDepth,
  swarmFade,
  swarmWorkingSet,
  visitReport,
  type SwarmEntry,
} from "./flight";
import { projectOnFold } from "./butterfly-render";
import { BUTTERFLY } from "./butterfly";
import { sheetRect } from "./paper";
import { planeCount, planeOf, planeTable } from "./planes";
import { planSeed } from "./seed-plan";
import { bucketsSince } from "./seasons";
import { TUNING_PANEL_INSET, TUNING_PANEL_WIDTH, TUNING_SIZE } from "./tuning-panel";

const TIP = { x: 0.5, y: 0.3 };

const TODAY = "2026-07-27";

// A kigo begun on `created` and, unless it says otherwise, last known true on
// the same day. The two dates are separate arguments because they drive
// separate channels — `created` sets the depth plane and never moves, `since`
// sets the fade and moves on every touch.
const entry = (id: string, created: string, since = created): SwarmEntry => ({
  id,
  category: "humanity",
  created,
  since,
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
        // Touched today, every one of them. The fade is therefore identical
        // across the whole swarm and every difference on screen is depth —
        // which is the only way to look at one channel at a time.
        since: today,
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

describe("choosing who comes", () => {
  // The whole of the choice, and the only part of a visit that can be got wrong
  // quietly: a rule that reached past the front of the box for something on the
  // back wall would look like the widget ignoring the pointer.
  const at = (id: string, x: number, y: number, plane: number) => ({ id, x, y, plane });

  it("has nobody to send when the box is empty", () => {
    expect(nearest([], 100, 100)).toBeNull();
  });

  it("sends the nearest in screen space, whatever plane it is on", () => {
    const far = at("k_far", 102, 100, 4);
    const near = at("k_near", 160, 100, 0);
    expect(nearest([near, far], 100, 100)).toBe(far);
    expect(nearest([far, near], 100, 100)).toBe(far);
  });

  it("gives a tie to the front plane, whichever order they arrive in", () => {
    // Equally close, so the one being *looked at* wins: it is bigger, sharper
    // and in front of the other.
    const front = at("k_front", 140, 100, 0);
    const back = at("k_back", 60, 100, 3);
    expect(nearest([back, front], 100, 100)).toBe(front);
    expect(nearest([front, back], 100, 100)).toBe(front);
  });
});

describe("coming to the cursor", () => {
  // Judged by eye, mostly. These are the parts that are not: the dwell, which
  // is what keeps a swept cursor from summoning a parade; the ladder of scales,
  // which is what keeps the approach out of the tile cache; and the promise
  // that coming forward is not the same as being younger.
  const bounds = flightBounds(420, 300);
  const MIDDLE = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
  const V = FLIGHT.visit;

  let clock = 0;
  const fly = (seconds: number) => {
    for (let i = 0, n = Math.max(1, Math.round(seconds * 60)); i < n; i++) {
      clock += 1 / 60;
      stepFlight(1 / 60, clock, bounds);
    }
  };

  // Put one kigo in the box, with nobody left over from the test before —
  // emptying the swarm first, because a flyer that keeps its place across a
  // `setSwarm` also keeps the plane it was already on.
  const alone = (created = TODAY): void => {
    endVisit();
    fly(2);
    setSwarm([], TODAY);
    fly(1 / 60);
    setSwarm([{ ...entry("k_visit1", created), text: "leaving my phone in the kitchen" }], TODAY);
    fly(0.1);
  };

  const rest = (at: { x: number; y: number }, seconds: number) => {
    setCursor(at.x, at.y);
    fly(seconds);
  };

  // Keep the pointer moving, so no dwell ever matures and nobody new is asked
  // for. A resting cursor would summon again the moment the last one got home,
  // which is correct and is exactly what these particular tests must avoid.
  const sweep = (from: { x: number; y: number }, seconds: number) => {
    for (let i = 0, n = Math.round(seconds * 60); i < n; i++) {
      setCursor(from.x + (i % 30), from.y);
      clock += 1 / 60;
      stepFlight(1 / 60, clock, bounds);
    }
  };

  it("is not summoned by a cursor passing through", () => {
    // The rule the whole gesture rests on. The box is small and the pointer
    // crosses it all day on its way somewhere else; a hover would peel a
    // creature off the swarm every time someone reached for the taskbar.
    alone();
    for (let i = 0; i < 120; i++) {
      setCursor(bounds.x + 4 + i * 2, MIDDLE.y);
      clock += 1 / 60;
      stepFlight(1 / 60, clock, bounds);
    }
    expect(visitReport()).toBeNull();
  });

  it("is summoned by a cursor that comes to rest", () => {
    alone();
    rest(MIDDLE, V.dwellSec / 2);
    expect(visitReport(), "it came before the dwell was up").toBeNull();
    rest(MIDDLE, V.dwellSec);
    expect(visitReport()?.id).toBe("k_visit1");
  });

  it("lands, opens, and grows well past the plane it came from", () => {
    // "Coming to you means coming nearer", and nearer is bigger — the same
    // perspective the planes already use. It has to end up large enough to
    // read a line off, which is most of the width of the sheet.
    alone();
    rest(MIDDLE, 4);
    const visit = visitReport()!;
    expect(visit.phase).toBe("alighted");
    expect(visit.u).toBeGreaterThan(0.98);
    expect(visit.scale).toBeGreaterThan(planeTable()[0].scale * 3);
    expect(visit.scale).toBe(V.span);
  });

  it("walks a short ladder of wingspans rather than a continuum", () => {
    // The claim the tile cache rests on, and the same bargain depth planes
    // strike: `scale` is part of the cache key, so an approach that eased its
    // size smoothly would mint a fresh sprite sheet on every frame of it.
    alone();
    setCursor(MIDDLE.x, MIDDLE.y);
    const scales = new Set<number>();
    for (let i = 0; i < 60 * 4; i++) {
      clock += 1 / 60;
      stepFlight(1 / 60, clock, bounds);
      const visit = visitReport();
      if (visit) scales.add(visit.scale);
    }
    expect(scales.size).toBeGreaterThan(1); // it did travel
    expect(scales.size).toBeLessThanOrEqual(Math.round(V.steps) + 1);
    // and each is what the cache key will read, not a value it rounds off
    for (const s of scales) expect(s).toBe(Number(s.toFixed(2)));
  });

  it("goes home when the cursor moves away, and rejoins its plane", () => {
    alone();
    rest(MIDDLE, 4);
    expect(visitReport()?.phase).toBe("alighted");

    setCursor(MIDDLE.x + V.leavePx * 2, MIDDLE.y);
    fly(1 / 60);
    expect(visitReport()?.phase, "it stayed").toBe("leaving");

    sweep({ x: MIDDLE.x + V.leavePx * 2, y: MIDDLE.y }, 4);
    expect(visitReport(), "it never got home").toBeNull();
    expect(flyerCount()).toBe(1);
  });

  it("goes home when the cursor leaves the sheet", () => {
    // No timeout and no dismissing it. Leaving is only ever moving away.
    alone();
    rest(MIDDLE, 4);
    clearCursor();
    fly(4);
    expect(visitReport()).toBeNull();
  });

  it("never sends a second while the first is still on its way home", () => {
    // Only ever one at a time, and the gap between one leaving and the next
    // being asked for is where a second could slip in.
    alone();
    rest(MIDDLE, 4);
    const first = visitReport()!.id;

    rest({ x: MIDDLE.x + V.leavePx * 3, y: MIDDLE.y }, V.dwellSec * 1.5);
    const during = visitReport();
    expect(during?.id).toBe(first);
    expect(during?.phase).toBe("leaving");
  });

  it("never moves a butterfly in depth by coming forward", () => {
    // Depth is age. Coming to the cursor is not being younger, and a butterfly
    // that had quietly changed plane on the way back would be a kigo that
    // rewrote its own created date by being looked at.
    alone("2019-05-01"); // long ago: the back wall
    const before = swarmDepth();
    expect(before[before.length - 1]).toBe(1);

    rest(MIDDLE, 4);
    expect(visitReport()?.phase).toBe("alighted");
    expect(swarmDepth(), "it changed plane on the way out").toEqual(before);

    clearCursor();
    fly(4);
    expect(swarmDepth(), "it changed plane on the way back").toEqual(before);
  });

  it("claims a press only on the one that has landed", () => {
    // CLAUDE.md: dragging must never swallow a touch, and the whole surface is
    // draggable. So exactly one creature ever claims a press — any more and a
    // third of the window becomes dead space where the widget cannot be moved.
    alone();
    expect(hitTest(MIDDLE.x, MIDDLE.y), "it claimed a press with nobody landed").toBe(false);

    rest(MIDDLE, 4);
    expect(hitTest(MIDDLE.x, MIDDLE.y)).toBe(true);
    expect(hitTest(bounds.x + 1, bounds.y + 1)).toBe(false);

    clearCursor();
    fly(4);
    expect(hitTest(MIDDLE.x, MIDDLE.y), "it kept claiming after it left").toBe(false);
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
