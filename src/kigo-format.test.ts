// The format is the twenty-year promise, so it is pinned against files a
// *person* might have left behind, not only against its own output.
//
// Two fixtures are hand-written as literal strings below. The tidy one is
// CLAUDE.md's example verbatim. The scruffy one is what the same file looks
// like after someone has opened it in an editor: a key in the wrong place, an
// inline comment, the touch list rewritten as a block, an optional field
// deleted, trailing spaces. Both must survive a read and a write unchanged —
// if this suite only ever fed the parser its own serialiser's output, every
// one of those would be free to break.

import { describe, expect, it } from "vitest";
import {
  CURRENT_SCHEMA,
  hasEmerged,
  lastKnownTrue,
  parseKigo,
  serialiseKigo,
  type Kigo,
} from "./kigo-format";
import { CATEGORY_PAPERS } from "./papers";

// CLAUDE.md's example, to the byte.
const TIDY = [
  "---",
  "schema: 1",
  "id: k_7f3a9c",
  "created: 2026-02-11",
  "season: spring/early",
  "category: humanity",
  'paper: "#c94f3d"',
  "touched: [2026-02-19, 2026-03-02]",
  "---",
  "# leaving my phone in the kitchen at dinner",
  "",
  "- still doing it, and dinner is longer now (2026-03-02)",
  "",
].join("\n");

// Written as an array so the trailing whitespace on two of these lines is
// visible here and cannot be tidied away by an editor on save.
const SCRUFFY = [
  "---",
  "id: k_0b41de   # immutable forever",
  "created: 2026-05-09",
  "category: plants",
  "schema: 1", // out of order
  "touched:", // a block list, not an inline one
  "  - 2026-05-20",
  "  - 2026-08-14",
  "mood: quiet", // a key this build has never heard of
  "---", // no season, no paper: both are derivable
  "#  watering the balcony pots before the heat  ",
  "  ",
  "- they made it through July (2026-08-14)",
  "",
].join("\n");

describe("reading the tidy file", () => {
  const kigo = parseKigo(TIDY);

  it("reads every field CLAUDE.md specifies", () => {
    expect(kigo).toMatchObject<Partial<Kigo>>({
      schema: 1,
      id: "k_7f3a9c",
      created: "2026-02-11",
      season: "spring/early",
      category: "humanity",
      paper: "#c94f3d",
      touched: ["2026-02-19", "2026-03-02"],
      text: "leaving my phone in the kitchen at dinner",
    });
    expect(kigo.verses).toEqual([
      { text: "still doing it, and dinner is longer now", date: "2026-03-02" },
    ]);
  });

  it("writes it back byte for byte", () => {
    expect(serialiseKigo(kigo)).toBe(TIDY);
  });
});

describe("reading the scruffy file", () => {
  const kigo = parseKigo(SCRUFFY);

  it("reads through the mess", () => {
    expect(kigo.id).toBe("k_0b41de"); // the trailing comment is not part of it
    expect(kigo.schema).toBe(1);
    expect(kigo.touched).toEqual(["2026-05-20", "2026-08-14"]); // block list
    expect(kigo.text).toBe("watering the balcony pots before the heat"); // spaces trimmed
    expect(kigo.verses).toEqual([{ text: "they made it through July", date: "2026-08-14" }]);
  });

  it("fills in the fields the file left out rather than failing", () => {
    expect(kigo.season).toBe("summer/early"); // derived from created: May 9
    expect(kigo.paper).toBe(CATEGORY_PAPERS.plants);
  });

  it("writes it back byte for byte, mess and all", () => {
    expect(serialiseKigo(kigo)).toBe(SCRUFFY);
  });

  // The point of the exercise: a field from a later version of the app has to
  // come back out again, or upgrading is a one-way door.
  it("keeps a key it does not understand, even through an edit", () => {
    const edited = serialiseKigo({ ...kigo, text: "watering the pots" });
    expect(edited).toContain("mood: quiet");
    expect(parseKigo(edited).text).toBe("watering the pots");
  });

  it("does not add back a field whose absence still means the same thing", () => {
    expect(serialiseKigo(kigo)).not.toContain("season:");
    expect(serialiseKigo(kigo)).not.toContain("paper:");
  });

  // The block list is three lines and its replacement is one, so this is the
  // case where a changed value has to take its whole raw form with it.
  it("replaces the block list rather than adding to it when a touch lands", () => {
    const out = serialiseKigo({ ...kigo, touched: [...kigo.touched, "2026-09-01"] });
    expect(out).toContain("touched: [2026-05-20, 2026-08-14, 2026-09-01]");
    expect(out).not.toContain("  - 2026-05-20");
    expect(parseKigo(out).touched).toEqual(["2026-05-20", "2026-08-14", "2026-09-01"]);
    expect(out).toContain("mood: quiet"); // and leaves everything around it alone
  });

  it("does write the field once its absence would be a lie", () => {
    const repainted = serialiseKigo({ ...kigo, paper: "#123456" });
    expect(repainted).toContain('paper: "#123456"');
    expect(parseKigo(repainted).paper).toBe("#123456");
  });
});

describe("round-tripping", () => {
  for (const [name, source] of [
    ["the tidy file", TIDY],
    ["the scruffy file", SCRUFFY],
  ] as const) {
    it(`loses nothing from ${name}`, () => {
      const once = parseKigo(source);
      const twice = parseKigo(serialiseKigo(once));
      expect(twice).toEqual(once);
      expect(serialiseKigo(twice)).toBe(source);
    });
  }

  it("survives Notepad's CRLF", () => {
    const crlf = TIDY.replace(/\n/g, "\r\n");
    const kigo = parseKigo(crlf);
    expect(kigo.text).toBe("leaving my phone in the kitchen at dinner");
    expect(serialiseKigo(kigo)).toBe(crlf); // not quietly converted to LF
  });

  it("survives Notepad's byte order mark", () => {
    const withBom = `﻿${TIDY}`;
    const kigo = parseKigo(withBom);
    expect(kigo.id).toBe("k_7f3a9c");
    expect(serialiseKigo(kigo)).toBe(withBom);
  });

  it("rewrites only the line that changed", () => {
    const kigo = parseKigo(TIDY);
    const after = serialiseKigo({ ...kigo, text: "leaving my phone in the kitchen" });
    const before = TIDY.split("\n");
    const changed = after.split("\n").filter((line, i) => line !== before[i]);
    expect(changed).toEqual(["# leaving my phone in the kitchen"]);
  });
});

describe("values a person would type", () => {
  // Real YAML would read an unquoted `#c94f3d` as a comment and hand back an
  // empty string. In this format a value that starts with # is a colour,
  // because losing someone's paper to a syntax rule is not a trade worth making.
  it("reads an unquoted colour as a colour", () => {
    const kigo = parseKigo(TIDY.replace('paper: "#c94f3d"', "paper: #c94f3d"));
    expect(kigo.paper).toBe("#c94f3d");
  });

  it("still drops a comment written after a value", () => {
    const kigo = parseKigo(TIDY.replace("category: humanity", "category: humanity  # persimmon"));
    expect(kigo.category).toBe("humanity");
  });

  it("quotes on the way out only where it has to", () => {
    const fresh = freshKigo({ text: "a line", paper: "#c94f3d" });
    const out = serialiseKigo(fresh);
    expect(out).toContain('paper: "#c94f3d"');
    expect(out).toContain("category: humanity");
    expect(out).toContain("id: k_000001");
  });

  it("reads a single touch written without brackets", () => {
    const kigo = parseKigo(TIDY.replace("touched: [2026-02-19, 2026-03-02]", "touched: 2026-02-19"));
    expect(kigo.touched).toEqual(["2026-02-19"]);
    expect(serialiseKigo(kigo)).toContain("touched: 2026-02-19"); // left as written
  });

  it("takes a verse that has parentheses of its own", () => {
    const kigo = parseKigo(TIDY.replace("(2026-03-02)", "(twice a week now)"));
    expect(kigo.verses).toEqual([
      { text: "still doing it, and dinner is longer now (twice a week now)", date: null },
    ]);
    expect(serialiseKigo(kigo)).toBe(TIDY.replace("(2026-03-02)", "(twice a week now)"));
  });
});

describe("a later version's file", () => {
  const future = TIDY.replace("schema: 1", "schema: 2").replace(
    "category: humanity",
    "category: weather\nwing-count: 6",
  );

  it("is readable, and its unknown category renders as seasonless", () => {
    const kigo = parseKigo(future);
    expect(kigo.schema).toBe(2);
    expect(kigo.category).toBe("muki");
  });

  // Never downgrade someone's file because we are the older build.
  it("is written back with its own version and its own words", () => {
    const out = serialiseKigo(parseKigo(future));
    expect(out).toContain("schema: 2");
    expect(out).toContain("category: weather");
    expect(out).toContain("wing-count: 6");
    expect(out).toBe(future);
  });
});

describe("verses", () => {
  it("adds one into the existing stanza", () => {
    const kigo = parseKigo(TIDY);
    const out = serialiseKigo({
      ...kigo,
      verses: [...kigo.verses, { text: "still true", date: "2026-06-01" }],
    });
    expect(out).toBe(
      TIDY.replace(
        "- still doing it, and dinner is longer now (2026-03-02)\n",
        "- still doing it, and dinner is longer now (2026-03-02)\n- still true (2026-06-01)\n",
      ),
    );
  });

  it("opens a stanza when there were none", () => {
    const bare = TIDY.replace("\n\n- still doing it, and dinner is longer now (2026-03-02)\n", "\n");
    const kigo = parseKigo(bare);
    expect(kigo.verses).toEqual([]);
    const out = serialiseKigo({ ...kigo, verses: [{ text: "still true", date: "2026-06-01" }] });
    expect(out).toBe(
      [
        "---",
        "schema: 1",
        "id: k_7f3a9c",
        "created: 2026-02-11",
        "season: spring/early",
        "category: humanity",
        'paper: "#c94f3d"',
        "touched: [2026-02-19, 2026-03-02]",
        "---",
        "# leaving my phone in the kitchen at dinner",
        "",
        "- still true (2026-06-01)",
        "",
      ].join("\n"),
    );
  });
});

describe("a kigo that has never been a file", () => {
  it("serialises to CLAUDE.md's shape", () => {
    const kigo = freshKigo({ text: "leaving my phone in the kitchen at dinner" });
    expect(serialiseKigo(kigo)).toBe(
      [
        "---",
        "schema: 1",
        "id: k_000001",
        "created: 2026-02-11",
        "season: spring/early",
        "category: humanity",
        'paper: "#c94f3d"',
        "touched: []",
        "---",
        "# leaving my phone in the kitchen at dinner",
        "",
      ].join("\n"),
    );
  });

  it("comes back out the same", () => {
    const kigo = freshKigo({ text: "a line" });
    const read = parseKigo(serialiseKigo(kigo));
    expect(read).toMatchObject({ ...kigo, raw: read.raw });
  });
});

describe("files that are not kigo", () => {
  it("refuses one with no frontmatter", () => {
    expect(() => parseKigo("# just a heading\n")).toThrow(/frontmatter/);
  });

  it("refuses one whose frontmatter never closes", () => {
    expect(() => parseKigo("---\nid: k_7f3a9c\n")).toThrow(/unterminated/);
  });

  // Without an id there is no creature, and inventing one would invent a
  // different butterfly than the entry has always had.
  it("refuses one with no id", () => {
    expect(() => parseKigo("---\ncreated: 2026-02-11\n---\n# a line\n")).toThrow(/no id/);
  });

  it("refuses one with no created date", () => {
    expect(() => parseKigo("---\nid: k_7f3a9c\n---\n# a line\n")).toThrow(/created/);
  });
});

describe("what the dates alone say", () => {
  // Two facts about a kigo that are computed rather than stored, and both are
  // computed rather than stored for the same reason: a field can rot, and two
  // dates cannot disagree with themselves.

  it("fades an untouched kigo from the day it was written", () => {
    // Not from nothing: writing it down was the first statement that it was
    // true, and an entry made this morning has not been neglected. The
    // alternative would make the recording ceremony produce a bleached
    // butterfly, which is precisely backwards.
    expect(lastKnownTrue(freshKigo())).toBe("2026-02-11");
    expect(lastKnownTrue(freshKigo({ touched: ["2026-03-02", "2026-05-01"] }))).toBe("2026-05-01");
  });

  it("keeps a kigo folded on the day it was recorded", () => {
    // The chrysalis. It stays a square until the widget is next opened on a
    // later day — the only thing in the app that ever asks you to come back,
    // and it asks by promising rather than demanding.
    const kigo = freshKigo({ created: "2026-02-11" });
    expect(hasEmerged(kigo, "2026-02-11")).toBe(false);
    expect(hasEmerged(kigo, "2026-02-12")).toBe(true);
    expect(hasEmerged(kigo, "2029-11-30")).toBe(true);
  });

  it("never expires the birth, however long it takes", () => {
    // "however long they take, the birth is waiting" — there is no window to
    // miss, so a kigo recorded three years ago and never looked at since is
    // simply emerged.
    expect(hasEmerged(freshKigo({ created: "2023-01-04" }), "2026-08-02")).toBe(true);
  });

  it("folds it back up if the clock is scrubbed behind it", () => {
    // Not a case a real user meets, but the dev scrubber goes both ways and a
    // derived answer has to survive that rather than half-remembering.
    expect(hasEmerged(freshKigo({ created: "2026-02-11" }), "2026-02-10")).toBe(false);
  });
});

function freshKigo(over: Partial<Kigo> = {}): Kigo {
  return {
    schema: CURRENT_SCHEMA,
    id: "k_000001",
    created: "2026-02-11",
    season: "spring/early",
    category: "humanity",
    paper: "#c94f3d",
    touched: [],
    text: "a line",
    verses: [],
    ...over,
  };
}
