// Date maths is where quiet bugs live, and this module has two places to hide
// them: the season year that opens in February, and the seven days New Year
// takes out of the middle of winter. Both are invisible for eleven months of
// the year, so they are pinned here a day at a time rather than left to be
// noticed one January.
//
// The style is deliberate: every boundary is tested with the day before it and
// the day after it, because an off-by-one in a calendar reads as correct from
// every direction except the two days that matter.

import { describe, expect, it } from "vitest";
import {
  addDays,
  bucketsSince,
  daysBetween,
  fromDayNumber,
  orderedBuckets,
  saturationFor,
  seasonOf,
  seasonYearOf,
  seasonsSince,
  stepSeason,
  toCivil,
  toDayNumber,
  toISODate,
  type BucketId,
  type CivilDate,
} from "./seasons";

const bucket = (iso: string): BucketId => seasonOf(iso).bucketId;

/**
 * Day arithmetic for the tests only — UTC so no DST hour ever shifts a date.
 *
 * Kept even though `addDays` now exists in the module, and deliberately built
 * out of a different mechanism: it is the independent oracle the real one is
 * checked against below. A test that used the implementation to verify itself
 * would agree with any bug it happened to contain.
 */
function shift(iso: string, days: number): string {
  const c = toCivil(iso);
  const t = Date.UTC(c.year, c.month - 1, c.day) + days * 86_400_000;
  const d = new Date(t);
  return toISODate({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
}

describe("season boundaries", () => {
  // CLAUDE.md's table: spring Feb 4, summer May 6, autumn Aug 8, winter Nov 7.
  const seasonStarts: Array<[string, string, string]> = [
    ["2026-02-04", "spring", "winter"],
    ["2026-05-06", "summer", "spring"],
    ["2026-08-08", "autumn", "summer"],
    ["2026-11-07", "winter", "autumn"],
  ];

  for (const [start, season, previous] of seasonStarts) {
    it(`turns to ${season} on ${start}, and not the day before`, () => {
      expect(seasonOf(start).season).toBe(season);
      expect(seasonOf(shift(start, 1)).season).toBe(season);
      expect(seasonOf(shift(start, -1)).season).toBe(previous);
    });
  }

  it("runs winter through to Feb 3 and no further", () => {
    expect(seasonOf("2026-02-03").season).toBe("winter");
    expect(seasonOf("2026-02-03").division).toBe("late");
    expect(seasonOf("2026-02-04").season).toBe("spring");
  });
});

describe("divisions", () => {
  // The 二十四節気 dates the divisions are cut on. Each is the first day of its
  // bucket; the day before belongs to the one before it.
  const starts: Array<[string, BucketId, BucketId]> = [
    ["2026-02-04", "spring/early", "winter/late"],
    ["2026-03-06", "spring/middle", "spring/early"],
    ["2026-04-05", "spring/late", "spring/middle"],
    ["2026-05-06", "summer/early", "spring/late"],
    ["2026-06-06", "summer/middle", "summer/early"],
    ["2026-07-07", "summer/late", "summer/middle"],
    ["2026-08-08", "autumn/early", "summer/late"],
    ["2026-09-08", "autumn/middle", "autumn/early"],
    ["2026-10-08", "autumn/late", "autumn/middle"],
    ["2026-11-07", "winter/early", "autumn/late"],
    ["2026-12-07", "winter/middle", "winter/early"],
  ];

  for (const [day, here, before] of starts) {
    it(`opens ${here} on ${day}`, () => {
      expect(bucket(day)).toBe(here);
      expect(bucket(shift(day, -1))).toBe(before);
    });
  }

  it("gives every season three divisions, in order", () => {
    for (const season of ["spring", "summer", "autumn", "winter"] as const) {
      const divisions = orderedBuckets()
        .filter((b) => b.startsWith(`${season}/`))
        .map((b) => b.split("/")[1]);
      expect(divisions).toEqual(["early", "middle", "late"]);
    }
  });
});

describe("the New Year carve-out", () => {
  it("takes Jan 1 through Jan 7 out of winter", () => {
    expect(bucket("2025-12-31")).toBe("winter/middle");
    expect(bucket("2026-01-01")).toBe("new-year");
    expect(bucket("2026-01-07")).toBe("new-year");
    expect(bucket("2026-01-08")).toBe("winter/late");
  });

  it("is its own thing, not a division of winter", () => {
    const place = seasonOf("2026-01-03");
    expect(place.season).toBe("new-year");
    expect(place.division).toBeNull();
    expect(place.bucketId).toBe("new-year");
  });

  // 小寒 (Jan 6) would open late winter, but the carve-out has those days, so
  // late winter resumes on Jan 8 instead. This is the one division boundary
  // that is not a solar term.
  it("swallows the solar term that would have opened late winter", () => {
    expect(bucket("2026-01-05")).toBe("new-year");
    expect(bucket("2026-01-06")).toBe("new-year");
    expect(bucket("2026-01-07")).toBe("new-year");
    expect(bucket("2026-01-08")).toBe("winter/late");
  });

  it("sits between middle and late winter in the ordered year", () => {
    const order = orderedBuckets();
    expect(order.indexOf("winter/middle")).toBeLessThan(order.indexOf("new-year"));
    expect(order.indexOf("new-year")).toBeLessThan(order.indexOf("winter/late"));
  });
});

describe("the season year", () => {
  // The trap: winter crosses the calendar year, so January belongs to the
  // season year that began the previous February.
  it("puts Jan 5 in the season year that opened last February", () => {
    expect(seasonYearOf("2026-01-05")).toBe(2025);
    expect(bucket("2026-01-05")).toBe("new-year");
  });

  it("keeps a whole winter in one season year across New Year's Eve", () => {
    expect(seasonYearOf("2025-11-07")).toBe(2025);
    expect(seasonYearOf("2025-12-31")).toBe(2025);
    expect(seasonYearOf("2026-01-01")).toBe(2025);
    expect(seasonYearOf("2026-02-03")).toBe(2025);
  });

  it("turns over on Feb 4 and nowhere else", () => {
    expect(seasonYearOf("2026-02-03")).toBe(2025);
    expect(seasonYearOf("2026-02-04")).toBe(2026);
    expect(seasonYearOf("2026-12-31")).toBe(2026);
    expect(seasonYearOf("2027-01-01")).toBe(2026);
  });
});

describe("leap years", () => {
  it("files Feb 29 in early spring", () => {
    expect(bucket("2024-02-29")).toBe("spring/early");
    expect(seasonYearOf("2024-02-29")).toBe(2024);
  });

  it("still ends winter on Feb 3", () => {
    expect(bucket("2024-02-03")).toBe("winter/late");
    expect(seasonYearOf("2024-02-03")).toBe(2023);
    expect(bucket("2024-02-04")).toBe("spring/early");
  });

  // Boundaries are calendar dates, so the extra day widens early spring by one
  // rather than pushing every later division a day out of place.
  it("does not drift the divisions that follow it", () => {
    for (const day of ["03-05", "03-06", "04-04", "04-05"]) {
      expect(bucket(`2024-${day}`)).toBe(bucket(`2025-${day}`));
    }
  });

  it("accepts Feb 29 only in a leap year", () => {
    expect(() => toCivil("2024-02-29")).not.toThrow();
    expect(() => toCivil("2025-02-29")).toThrow();
    expect(() => toCivil("2100-02-29")).toThrow(); // a century that is not a leap year
    expect(() => toCivil("2000-02-29")).not.toThrow();
  });
});

describe("a whole season year, one day at a time", () => {
  // The strongest statement available: walk every day from Feb 4 to Feb 3 and
  // check the bucket only ever moves forwards through orderedBuckets(), and
  // that all thirteen are visited. Any overlap, gap, or misordered boundary
  // fails here without needing to be predicted.
  for (const [label, start] of [
    ["a common year", "2025-02-04"],
    ["a leap year", "2024-02-04"],
  ] as const) {
    it(`covers ${label} without a gap, an overlap, or a step backwards`, () => {
      const order = orderedBuckets();
      const seen = new Set<BucketId>();
      let position = -1;
      let day: string = start;
      const end = `${Number(start.slice(0, 4)) + 1}-02-03`;
      let guard = 0;
      for (;;) {
        const index = order.indexOf(bucket(day));
        expect(index, `${day} is in no bucket`).toBeGreaterThanOrEqual(0);
        expect(index, `${day} steps backwards`).toBeGreaterThanOrEqual(position);
        position = index;
        seen.add(bucket(day));
        expect(seasonYearOf(day)).toBe(Number(start.slice(0, 4)));
        if (day === end) break;
        day = shift(day, 1);
        expect(++guard).toBeLessThan(400);
      }
      expect(seen.size).toBe(order.length);
    });
  }

  it("has thirteen buckets: four seasons of three, plus New Year", () => {
    const order = orderedBuckets();
    expect(order).toHaveLength(13);
    expect(new Set(order).size).toBe(13);
    expect(order[0]).toBe("spring/early");
    expect(order[order.length - 1]).toBe("winter/late");
  });
});

describe("seasonsSince", () => {
  it("is zero within one season", () => {
    expect(seasonsSince("2026-02-04", "2026-05-05")).toBe(0);
    expect(seasonsSince("2026-02-11", "2026-02-11")).toBe(0);
  });

  it("counts one at each season boundary", () => {
    expect(seasonsSince("2026-02-03", "2026-02-04")).toBe(1);
    expect(seasonsSince("2026-05-05", "2026-05-06")).toBe(1);
    expect(seasonsSince("2026-08-07", "2026-08-08")).toBe(1);
    expect(seasonsSince("2026-11-06", "2026-11-07")).toBe(1);
  });

  // The reason New Year is not a fifth season for fading: a kigo touched on
  // Jan 3 must not have aged by Jan 8.
  it("does not age anything across the New Year carve-out", () => {
    expect(seasonsSince("2025-12-20", "2026-01-03")).toBe(0);
    expect(seasonsSince("2026-01-03", "2026-01-10")).toBe(0);
    expect(seasonsSince("2025-11-07", "2026-02-03")).toBe(0);
  });

  it("counts four to the year and twelve to three years", () => {
    expect(seasonsSince("2026-02-11", "2027-02-11")).toBe(4);
    expect(seasonsSince("2026-02-11", "2029-02-11")).toBe(12);
  });

  it("goes backwards rather than pretending", () => {
    expect(seasonsSince("2026-05-06", "2026-02-04")).toBe(-1);
  });

  it("reads a Date the same way it reads a string", () => {
    const jan = new Date(2026, 0, 5); // local, as a person means it
    expect(seasonYearOf(jan)).toBe(2025);
    expect(seasonOf(jan).bucketId).toBe("new-year");
    expect(seasonsSince("2025-11-07", jan)).toBe(0);
  });
});

describe("saturationFor", () => {
  it("is CLAUDE.md's curve", () => {
    expect(saturationFor(0)).toBe(1);
    expect(saturationFor(1)).toBe(0.85);
    expect(saturationFor(2)).toBe(0.65);
    expect(saturationFor(3)).toBe(0.5);
    expect(saturationFor(4)).toBe(0.4);
  });

  // "Nothing dies": neglect bleaches, it does not erase, so the floor holds
  // however long an entry is left alone.
  it("never goes below the floor, however long it has been", () => {
    for (const n of [4, 5, 12, 40, 4000]) {
      expect(saturationFor(n)).toBe(0.4);
    }
  });

  it("treats a touch in the future as full colour rather than an error", () => {
    expect(saturationFor(-1)).toBe(1);
    expect(saturationFor(-99)).toBe(1);
  });

  it("only ever fades", () => {
    let previous = Infinity;
    for (let n = 0; n <= 20; n++) {
      const s = saturationFor(n);
      expect(s).toBeLessThanOrEqual(previous);
      expect(s).toBeGreaterThanOrEqual(0.4);
      previous = s;
    }
  });
});

describe("civil dates", () => {
  // The classic: new Date("2026-02-11") is UTC midnight, which is Feb 10 for
  // anyone west of Greenwich. Parsing is by hand so a user's entry cannot slide
  // a day backwards depending on where they are sitting.
  it("does not slide an ISO date by a timezone", () => {
    expect(toCivil("2026-02-11")).toEqual<CivilDate>({ year: 2026, month: 2, day: 11 });
    expect(toISODate("2026-02-11")).toBe("2026-02-11");
  });

  it("refuses dates that do not exist", () => {
    expect(() => toCivil("2026-02-30")).toThrow();
    expect(() => toCivil("2026-13-01")).toThrow();
    expect(() => toCivil("2026-00-10")).toThrow();
    expect(() => toCivil("2026-2-11")).toThrow(); // not padded
    expect(() => toCivil("11/02/2026")).toThrow();
    expect(() => toCivil(new Date(NaN))).toThrow();
  });

  it("round-trips through ISO", () => {
    for (const iso of ["2026-01-01", "2024-02-29", "2026-12-31"]) {
      expect(toISODate(toCivil(iso))).toBe(iso);
    }
  });
});

describe("day arithmetic", () => {
  it("agrees with an independent implementation across four years, one day at a time", () => {
    // The oracle is `shift`, which goes through Date.UTC and therefore shares
    // no code with addDays at all. Four years covers two Februaries of each
    // kind and every month length.
    let iso = "2024-01-01";
    for (let i = 0; i < 4 * 366; i++) {
      expect(toISODate(addDays(iso, 1))).toBe(shift(iso, 1));
      iso = shift(iso, 1);
    }
  });

  it("steps over the ends of months, years and Februaries", () => {
    expect(toISODate(addDays("2026-01-31", 1))).toBe("2026-02-01");
    expect(toISODate(addDays("2026-02-28", 1))).toBe("2026-03-01");
    expect(toISODate(addDays("2024-02-28", 1))).toBe("2024-02-29");
    expect(toISODate(addDays("2024-02-29", 1))).toBe("2024-03-01");
    expect(toISODate(addDays("2026-12-31", 1))).toBe("2027-01-01");
    expect(toISODate(addDays("2027-01-01", -1))).toBe("2026-12-31");
    expect(toISODate(addDays("2024-03-01", -1))).toBe("2024-02-29");
  });

  it("counts a year as 365 days, and a leap year as 366", () => {
    expect(daysBetween("2026-01-01", "2027-01-01")).toBe(365);
    expect(daysBetween("2024-01-01", "2025-01-01")).toBe(366);
    expect(daysBetween("2026-07-27", "2026-07-27")).toBe(0);
    expect(daysBetween("2026-07-27", "2026-07-26")).toBe(-1);
  });

  it("round-trips through a day number", () => {
    for (const iso of ["1970-01-01", "1969-12-31", "2024-02-29", "2026-07-27", "2099-12-31"]) {
      expect(toISODate(fromDayNumber(toDayNumber(iso)))).toBe(iso);
    }
    expect(toDayNumber("1970-01-01")).toBe(0);
  });
});

describe("stepSeason", () => {
  // What the time-scrubber moves by. The property that matters is that a step
  // of n seasons is worth exactly n to the fading curve — anything else and
  // scrubbing forward would drain a different amount of colour than scrubbing
  // back restores.
  it("moves the fading curve by exactly the number of steps asked for", () => {
    for (const from of ["2026-02-04", "2026-07-27", "2026-11-06", "2027-01-03", "2024-02-29"]) {
      for (const n of [-9, -4, -2, -1, 0, 1, 2, 4, 9]) {
        expect(seasonsSince(from, stepSeason(from, n))).toBe(n);
      }
    }
  });

  it("lands on the day the season opened", () => {
    expect(toISODate(stepSeason("2026-07-27", 0))).toBe("2026-05-06");
    expect(toISODate(stepSeason("2026-07-27", 1))).toBe("2026-08-08");
    expect(toISODate(stepSeason("2026-07-27", -1))).toBe("2026-02-04");
    expect(toISODate(stepSeason("2026-07-27", 4))).toBe("2027-05-06");
  });

  // New Year is a bucket, not a season. Stepping out of it has to go to spring,
  // because a scrubber that stopped on Jan 1 would move the date by a week and
  // the colour by nothing at all.
  it("treats the New Year carve-out as the winter it was cut from", () => {
    expect(toISODate(stepSeason("2027-01-03", 0))).toBe("2026-11-07");
    expect(toISODate(stepSeason("2027-01-03", 1))).toBe("2027-02-04");
    expect(toISODate(stepSeason("2026-12-20", 0))).toBe("2026-11-07");
  });

  it("crosses the season year's February boundary in both directions", () => {
    expect(toISODate(stepSeason("2027-01-20", 1))).toBe("2027-02-04");
    expect(toISODate(stepSeason("2027-02-10", -1))).toBe("2026-11-07");
  });

  it("is its own inverse", () => {
    for (const from of ["2026-03-15", "2026-11-30", "2027-01-05"]) {
      const there = stepSeason(from, 3);
      expect(toISODate(stepSeason(there, -3))).toBe(toISODate(stepSeason(from, 0)));
    }
  });
});

describe("bucketsSince", () => {
  // What depth counts in. The fading curve counts seasons and folds New Year
  // into winter; this counts all thirteen buckets, so the two disagree on
  // purpose and the disagreement is the point — one channel is age and the
  // other is aliveness, and they must be able to move independently.

  it("is zero inside one bucket, however many days that is", () => {
    // autumn/early runs Aug 8 to Sep 7, and every day of it is the same
    // distance back. CLAUDE.md: kigo from the same bucket share a plane.
    for (const day of ["2026-08-08", "2026-08-20", "2026-09-01", "2026-09-07"]) {
      expect(bucketsSince(day, "2026-08-08"), day).toBe(0);
      expect(bucketsSince("2026-08-08", day), day).toBe(0);
    }
    expect(bucketsSince("2026-09-07", "2026-09-08")).toBe(1); // 白露, next bucket
  });

  it("counts one per division, in order, right round a season year", () => {
    // Every bucket boundary, walked. Thirteen steps from one 立春 to the next.
    const opens = [
      "2026-02-04", "2026-03-06", "2026-04-05", "2026-05-06", "2026-06-06",
      "2026-07-07", "2026-08-08", "2026-09-08", "2026-10-08", "2026-11-07",
      "2026-12-07", "2027-01-01", "2027-01-08",
    ];
    expect(opens.length).toBe(orderedBuckets().length);
    opens.forEach((day, i) => {
      expect(bucketsSince(opens[0], day), day).toBe(i);
    });
    expect(bucketsSince(opens[0], "2027-02-04")).toBe(13);
  });

  it("stays contiguous across the New Year carve-out", () => {
    // The trap. New Year and late winter both fall in the calendar year *after*
    // the season year they belong to, and they are the eleventh and twelfth
    // buckets of it. An off-by-one here would put a January kigo a whole year
    // deeper into the box than it belongs.
    expect(bucketsSince("2026-12-20", "2027-01-03")).toBe(1); // winter/middle -> new-year
    expect(bucketsSince("2027-01-03", "2027-01-20")).toBe(1); // new-year -> winter/late
    expect(bucketsSince("2027-01-20", "2027-02-04")).toBe(1); // winter/late -> spring/early
  });

  it("is signed, and a date in the future counts backwards", () => {
    expect(bucketsSince("2026-08-08", "2026-05-06")).toBe(-3);
    expect(bucketsSince("2027-01-03", "2026-12-20")).toBe(-1);
  });

  it("counts three buckets to a season, everywhere except New Year", () => {
    // Which is why `}` steps the front of the box back one plane: the near
    // planes are one season deep, and a season is three buckets.
    for (const from of ["2026-02-04", "2026-05-06", "2026-08-08"]) {
      expect(bucketsSince(from, toISODate(stepSeason(from, 1))), from).toBe(3);
    }
    // Winter is the exception, and it is New Year that takes the extra one:
    // early, middle, new-year, late. So a season scrub through winter recedes
    // the front of the box by four buckets rather than three — which the plane
    // edges absorb, because they are one season *or more* deep and only the
    // nearest one is exactly a season.
    expect(bucketsSince("2026-11-07", "2027-02-04")).toBe(4);
  });

  it("agrees with the ordering of the buckets it counts", () => {
    // A year of days: the count never goes backwards and never skips.
    let previous = 0;
    for (let d = 0; d < 400; d++) {
      const day = toISODate(addDays("2026-02-04", d));
      const n = bucketsSince("2026-02-04", day);
      expect(n === previous || n === previous + 1, `${day} jumped ${previous} -> ${n}`).toBe(true);
      previous = n;
    }
    // 2026-02-04 + 399 days is 2027-03-10, which is thirteen buckets to the
    // next 立春 and one more into spring/middle behind it.
    expect(previous).toBe(14);
  });
});
