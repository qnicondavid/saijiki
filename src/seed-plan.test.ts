// The seeder exists so that year-three state can be looked at on day one, and
// it only does that if its shape is right. A flat 150/39 would look like data
// and prove nothing: every bucket equally busy, every butterfly at full colour,
// every wing carrying the same amount of text.
//
// So the shape is what is tested. Not "did it produce a hundred and fifty
// files" — that is the easy half — but "is anything visible that would not be
// visible with an empty store".

import { describe, expect, it } from "vitest";
import { parseKigo, serialiseKigo } from "./kigo-format";
import { CATEGORIES } from "./papers";
import { planSeed, summaryLines, type SeedPlan } from "./seed-plan";
import { pathFor, slug } from "./store";
import { assertStorePath } from "./kigo-io";
import { saturationFor, seasonOf, seasonsSince } from "./seasons";

const TODAY = "2026-07-27";
const plan: SeedPlan = planSeed({ today: TODAY });

describe("how much there is", () => {
  it("plans exactly a hundred and fifty", () => {
    expect(plan.kigo).toHaveLength(150);
    expect(plan.buckets.reduce((n, b) => n + b.count, 0)).toBe(150);
  });

  it("spreads them over three years", () => {
    expect(plan.summary.span.from).toBe("2023-05-06");
    expect(plan.summary.span.to).toBe(TODAY);
    const created = plan.kigo.map((k) => k.created);
    expect(Math.min(...created.map(Number.parseFloat))).toBeTruthy();
    expect(created[0] >= "2023-05-06").toBe(true);
    expect(created[created.length - 1] <= TODAY).toBe(true);
  });

  it("hands out ids that are unique, and stable across runs", () => {
    const ids = new Set(plan.kigo.map((k) => k.id));
    expect(ids.size).toBe(150);
    for (const id of ids) expect(id).toMatch(/^k_[0-9a-f]{6}$/);
    // The seed rule: a butterfly's whole appearance derives from its id, so a
    // seeder that minted fresh ids each run would give a different swarm every
    // time and make "did that change?" unanswerable.
    expect(planSeed({ today: TODAY }).kigo.map((k) => k.id)).toEqual(plan.kigo.map((k) => k.id));
  });
});

describe("clustered the way a life is", () => {
  const counts = plan.buckets.map((b) => b.count);

  it("leaves several buckets empty", () => {
    expect(plan.summary.buckets.empty).toBeGreaterThanOrEqual(3);
  });

  it("gives some buckets exactly three", () => {
    expect(counts).toContain(3);
  });

  it("never gives one twelve", () => {
    expect(plan.summary.buckets.busiest).toBeLessThan(12);
  });

  it("is lumpy rather than flat", () => {
    // The failure this catches is a distribution that adds up correctly and
    // still puts four in every bucket, which looks like data and proves
    // nothing about depth clustering.
    expect(new Set(counts).size).toBeGreaterThanOrEqual(5);
  });

  it("never puts two kigo on one day", () => {
    const days = plan.kigo.map((k) => k.created);
    expect(new Set(days).size).toBe(days.length);
  });

  it("files every kigo under the bucket its date actually falls in", () => {
    for (const k of plan.kigo) expect(k.season).toBe(seasonOf(k.created).bucketId);
  });
});

describe("varied enough to be worth looking at", () => {
  it("uses all eight papers", () => {
    for (const category of CATEGORIES) {
      expect(plan.summary.categories[category], category).toBeGreaterThan(0);
    }
  });

  it("carries verse counts from zero to six", () => {
    const counts = new Set(plan.kigo.map((k) => k.verses.length));
    expect(Math.min(...counts)).toBe(0);
    expect(Math.max(...counts)).toBe(6);
  });

  it("only ever dates a verse on a day the kigo was touched", () => {
    // A verse is written during a touch. That is the ceremony, so it is also
    // the constraint — a verse on a day nothing happened is not a thing the app
    // can produce and must not be a thing the seeder produces either.
    for (const k of plan.kigo) {
      for (const verse of k.verses) expect(k.touched).toContain(verse.date);
    }
  });

  it("never touches a kigo before it existed, or after today", () => {
    for (const k of plan.kigo) {
      for (const day of k.touched) {
        expect(day >= k.created, `${k.id} touched ${day}, created ${k.created}`).toBe(true);
        expect(day <= TODAY).toBe(true);
      }
      expect([...k.touched]).toEqual([...k.touched].sort());
    }
  });
});

describe("the fading curve, made visible", () => {
  // Without this spread every butterfly sits at full colour and the curve is
  // untested by looking, however well tested it is by seasons.test.ts.
  const share = (n: number) => n / plan.kigo.length;

  it("puts roughly a third in each of the three groups", () => {
    const { fresh, stale, untouched } = plan.summary.touch;
    expect(fresh + stale + untouched).toBe(150);
    for (const n of [fresh, stale, untouched]) {
      expect(share(n)).toBeGreaterThan(0.15);
      expect(share(n)).toBeLessThan(0.55);
    }
  });

  it("reaches every step the three groups can reach, including the floor", () => {
    // 0, 1, 2 and 4+. Three seasons stale is not one of the groups CLAUDE.md's
    // seeder asks for — it falls between "one or two seasons stale" and
    // "untouched for over a year" — so it is unreachable standing still and is
    // covered by the scrub test below instead.
    for (const stale of [0, 1, 2, 4]) {
      expect(plan.summary.fade[stale], `${stale} seasons stale`).toBeGreaterThan(0);
    }
  });

  it("brings the fifth level into view as soon as time moves", () => {
    // This is the Part D property stated as data: a season of scrubbing has to
    // move colour. The 0.5 step is the proof that it moves by the curve rather
    // than by some approximation of it.
    const at = (today: string) =>
      new Set(
        plan.kigo.map((k) =>
          saturationFor(seasonsSince(k.touched[k.touched.length - 1] ?? k.created, today)),
        ),
      );
    expect([...at(TODAY)].sort((a, b) => a - b)).toEqual([0.4, 0.65, 0.85, 1]);
    expect([...at("2026-08-08")].sort((a, b) => a - b)).toEqual([0.4, 0.5, 0.65, 0.85]);
  });

  it("leaves the untouched ones untouched rather than pretending", () => {
    const never = plan.kigo.filter((k) => k.touched.length === 0);
    expect(never.length).toBeGreaterThan(0);
    // "untouched for over a year" — four seasons and therefore on the floor
    for (const k of never) expect(seasonsSince(k.created, TODAY)).toBeGreaterThanOrEqual(4);
  });
});

describe("obviously synthetic", () => {
  // This data ends up in screenshots. The one thing worse than a demo that
  // looks fake is a demo that looks like a stranger's diary.
  it("says so in every line", () => {
    for (const k of plan.kigo) expect(k.text).toMatch(/^sample kigo \d{3} · /);
    for (const k of plan.kigo) for (const v of k.verses) expect(v.text).toMatch(/^sample verse · /);
  });

  it("still varies enough to be worth laying out", () => {
    const lengths = plan.kigo.map((k) => k.text.length);
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeGreaterThan(10);
    expect(new Set(plan.kigo.map((k) => k.text)).size).toBeGreaterThan(100);
  });
});

describe("it writes files the rest of the app can read back", () => {
  it("round-trips through the real serialiser", () => {
    for (const k of plan.kigo) {
      const back = parseKigo(serialiseKigo(k));
      expect(back.id).toBe(k.id);
      expect(back.created).toBe(k.created);
      expect(back.season).toBe(k.season);
      expect(back.category).toBe(k.category);
      expect(back.paper).toBe(k.paper);
      expect(back.touched).toEqual(k.touched);
      expect(back.text).toBe(k.text);
      expect(back.verses).toEqual(k.verses);
    }
  });

  it("lands on paths the store guard accepts, one per kigo", () => {
    const taken = new Map<string, string>();
    for (const k of plan.kigo) {
      const path = pathFor(k, taken);
      expect(() => assertStorePath(path)).not.toThrow();
      expect(taken.has(path)).toBe(false);
      taken.set(path, k.id);
    }
    expect(taken.size).toBe(150);
  });

  it("slugs into filenames a person would recognise in a directory listing", () => {
    expect(slug(plan.kigo[0].text)).toMatch(/^sample-kigo-\d{3}-/);
  });
});

describe("the printout", () => {
  it("shows the three things the shape is for", () => {
    const text = summaryLines(plan.summary).join("\n");
    expect(text).toContain("150 kigo");
    expect(text).toContain("buckets:");
    expect(text).toContain("papers:");
    expect(text).toContain("seasons since last touch");
  });
});

describe("it holds up on other days", () => {
  // A plan is made against a date, and two of the three touch groups are
  // defined relative to it. Anchoring the tests above on one day would let a
  // seeder that only works in late summer pass all of them.
  for (const today of ["2026-01-03", "2026-02-04", "2026-11-07", "2024-02-29", "2027-12-31"]) {
    it(`plans a full, spread saijiki as of ${today}`, () => {
      const other = planSeed({ today });
      expect(other.kigo).toHaveLength(150);
      expect(other.summary.buckets.busiest).toBeLessThan(12);
      expect(other.summary.buckets.empty).toBeGreaterThanOrEqual(3);
      for (const stale of [0, 1, 2, 4]) {
        expect(other.summary.fade[stale], `${stale} seasons stale`).toBeGreaterThan(0);
      }
      for (const category of CATEGORIES) {
        expect(other.summary.categories[category], category).toBeGreaterThan(0);
      }
    });
  }
});
