// Storage, against a Map rather than a disk.
//
// Everything here runs on the in-memory KigoIO, so the suite needs no temp
// directories, no cleanup, and — the part that matters — has no route to the
// user's real store even if something in it is wrong. The Rust implementation
// of the same four verbs is exercised by hand in step 5.
//
// Two invariants get the most attention, because both are silent when broken:
// the id never changes, and index.json never matters.

import { describe, expect, it } from "vitest";
import { parseKigo, type Kigo } from "./kigo-format";
import { createMemoryIO, type MemoryIO } from "./kigo-io";
import { CATEGORY_PAPERS } from "./papers";
import {
  applyMigrations,
  createStore,
  INDEX_PATH,
  KIGO_DIR,
  slug,
  type KigoStore,
} from "./store";

/** Ids in order, so a test can name the entry it just made. */
function counter(): () => string {
  let n = 0;
  return () => `k_${String(++n).padStart(6, "0")}`;
}

function fresh(): { io: MemoryIO; store: KigoStore } {
  const io = createMemoryIO();
  return { io, store: createStore(io, { newId: counter() }) };
}

const DRAFT = {
  text: "leaving my phone in the kitchen at dinner",
  category: "humanity",
  created: "2026-02-11",
} as const;

describe("recording", () => {
  it("writes one markdown file and the cache, and nothing else", async () => {
    const { io, store } = fresh();
    await store.create(DRAFT);
    expect([...io.files.keys()].sort()).toEqual([
      "index.json",
      "kigo/2026-02-11-leaving-my-phone-in-the-kitchen-at-dinner.md",
    ]);
  });

  // This is the file the user opens in Notepad in twenty years. It should be
  // pleasant, so it is asserted whole rather than field by field.
  it("writes a file a person would be happy to find", async () => {
    const { io, store } = fresh();
    const kigo = await store.create(DRAFT);
    expect(io.files.get(`${KIGO_DIR}/2026-02-11-leaving-my-phone-in-the-kitchen-at-dinner.md`)).toBe(
      [
        "---",
        "schema: 1",
        "id: k_000001",
        "created: 2026-02-11",
        "season: spring/early",
        "category: humanity",
        `paper: "${CATEGORY_PAPERS.humanity}"`, // the category's stock, unless one was picked
        "touched: []",
        "---",
        "# leaving my phone in the kitchen at dinner",
        "",
      ].join("\n"),
    );
    expect(kigo.season).toBe("spring/early"); // filed by the saijiki calendar
  });

  it("files a January entry in the season year that opened last February", async () => {
    const { store } = fresh();
    const kigo = await store.create({ ...DRAFT, created: "2026-01-05" });
    expect(kigo.season).toBe("new-year");
  });

  it("refuses a slip with no line on it", async () => {
    const { store } = fresh();
    await expect(store.create({ ...DRAFT, text: "   " })).rejects.toThrow(/one line/);
  });

  it("keeps minting until it finds an id nobody is using", async () => {
    const io = createMemoryIO();
    const ids = ["k_aaaaaa", "k_aaaaaa", "k_bbbbbb"];
    let i = 0;
    const store = createStore(io, { newId: () => ids[i++] });
    const first = await store.create(DRAFT);
    const second = await store.create({ ...DRAFT, text: "another line" });
    expect(first.id).toBe("k_aaaaaa");
    expect(second.id).toBe("k_bbbbbb"); // the repeat was skipped, not overwritten
    expect((await store.all()).length).toBe(2);
  });

  it("gives two entries with the same date and the same words two files", async () => {
    const { io, store } = fresh();
    const a = await store.create(DRAFT);
    const b = await store.create(DRAFT);
    expect([...io.files.keys()].filter((p) => p.startsWith(KIGO_DIR)).length).toBe(2);
    expect((await store.read(a.id))?.id).toBe(a.id);
    expect((await store.read(b.id))?.id).toBe(b.id);
  });
});

describe("the id never changes", () => {
  // The seed rule, from the storage side: a butterfly is derived from its id
  // alone, so anything that moves the id replaces the creature.
  it("survives the file being renamed", async () => {
    const { io, store } = fresh();
    const made = await store.create(DRAFT);
    const [path] = [...io.files.keys()].filter((p) => p.startsWith(KIGO_DIR));

    const contents = io.files.get(path)!;
    io.files.delete(path);
    io.files.set(`${KIGO_DIR}/renamed-by-hand.md`, contents);

    const found = await store.read(made.id);
    expect(found?.id).toBe(made.id);
    expect(found?.created).toBe(made.created);
    expect(found?.text).toBe(made.text);
  });

  it("survives the text being edited, even though the filename does not", async () => {
    const { io, store } = fresh();
    const made = await store.create(DRAFT);
    const before = [...io.files.keys()].find((p) => p.startsWith(KIGO_DIR))!;

    const edited = await store.update(made.id, { text: "leaving my phone in the kitchen" });
    const after = [...io.files.keys()].find((p) => p.startsWith(KIGO_DIR))!;

    expect(edited.id).toBe(made.id);
    expect(edited.created).toBe(made.created);
    expect(edited.season).toBe(made.season);
    expect(after).not.toBe(before);
    expect(after).toBe(`${KIGO_DIR}/2026-02-11-leaving-my-phone-in-the-kitchen.md`);
    expect(io.files.has(before)).toBe(false); // no duplicate left behind
    expect(parseKigo(io.files.get(after)!).id).toBe(made.id);
  });

  it("survives being re-filed under another category", async () => {
    const { store } = fresh();
    const made = await store.create(DRAFT);
    const edited = await store.update(made.id, { category: "plants", paper: "#8b9159" });
    expect(edited.id).toBe(made.id);
    expect(edited.category).toBe("plants");
    expect((await store.read(made.id))?.paper).toBe("#8b9159");
  });
});

describe("touching", () => {
  it("adds the day and keeps the list in order", async () => {
    const { store } = fresh();
    const made = await store.create(DRAFT);
    await store.touch(made.id, "2026-03-02");
    await store.touch(made.id, "2026-02-19");
    expect((await store.read(made.id))?.touched).toEqual(["2026-02-19", "2026-03-02"]);
  });

  // Touching means "still true". Saying it twice in a day is saying it once.
  it("counts two touches on one day as one", async () => {
    const { store } = fresh();
    const made = await store.create(DRAFT);
    await store.touch(made.id, "2026-02-19");
    await store.touch(made.id, "2026-02-19");
    expect((await store.read(made.id))?.touched).toEqual(["2026-02-19"]);
  });

  it("takes the one verse a touch may carry", async () => {
    const { store } = fresh();
    const made = await store.create(DRAFT);
    await store.touch(made.id, "2026-03-02", "still doing it, and dinner is longer now");
    const read = await store.read(made.id);
    expect(read?.verses).toEqual([
      { text: "still doing it, and dinner is longer now", date: "2026-03-02" },
    ]);
  });

  it("does not rename the file", async () => {
    const { io, store } = fresh();
    const made = await store.create(DRAFT);
    const before = [...io.files.keys()].sort();
    await store.touch(made.id, "2026-03-02", "still true");
    expect([...io.files.keys()].sort()).toEqual(before);
  });
});

describe("index.json is only ever a cache", () => {
  it("rebuilds completely from the kigo directory", async () => {
    const { io, store } = fresh();
    await store.create(DRAFT);
    await store.create({ ...DRAFT, text: "a walk before the light goes", created: "2026-09-30" });

    io.files.delete(INDEX_PATH);
    const rebuilt = await store.index();
    expect(rebuilt.entries.map((e) => e.text)).toEqual([
      "leaving my phone in the kitchen at dinner",
      "a walk before the light goes",
    ]);
    expect(io.files.has(INDEX_PATH)).toBe(true); // and put back
  });

  it("is not needed to read anything", async () => {
    const { io, store } = fresh();
    const made = await store.create(DRAFT);
    io.files.delete(INDEX_PATH);
    expect((await store.read(made.id))?.text).toBe(DRAFT.text);
    expect((await store.all()).length).toBe(1);
  });

  it("can be deleted between any two operations", async () => {
    const { io, store } = fresh();
    const made = await store.create(DRAFT);
    for (const step of [
      () => store.touch(made.id, "2026-02-19"),
      () => store.update(made.id, { text: "phone in the kitchen" }),
      () => store.touch(made.id, "2026-03-02", "still true"),
    ]) {
      io.files.delete(INDEX_PATH);
      await step();
    }
    const read = await store.read(made.id);
    expect(read?.touched).toEqual(["2026-02-19", "2026-03-02"]);
    expect(read?.verses).toHaveLength(1);
    expect(read?.id).toBe(made.id);
  });

  it("is ignored when it lies about where an entry lives", async () => {
    const { io, store } = fresh();
    const made = await store.create(DRAFT);
    io.files.set(
      INDEX_PATH,
      JSON.stringify({
        schema: 1,
        entries: [{ id: made.id, path: `${KIGO_DIR}/somewhere-else.md` }],
      }),
    );
    expect((await store.read(made.id))?.text).toBe(DRAFT.text);
  });

  it("is ignored when it is truncated or nonsense", async () => {
    const { io, store } = fresh();
    const made = await store.create(DRAFT);
    io.files.set(INDEX_PATH, '{"schema": 1, "entr');
    expect((await store.read(made.id))?.id).toBe(made.id);
    expect((await store.index()).entries).toHaveLength(1);
  });

  // The entry is already safely written by then. Losing the cache is not worth
  // failing a write the user just made.
  it("does not take an entry down with it when it cannot be written", async () => {
    const { io, store } = fresh();
    io.failWrite(INDEX_PATH, 5);
    const made = await store.create(DRAFT);
    expect(io.files.has(INDEX_PATH)).toBe(false);
    expect((await store.read(made.id))?.text).toBe(DRAFT.text);
  });

  it("is rebuilt when files appear behind the app's back", async () => {
    const { io, store } = fresh();
    await store.create(DRAFT);
    io.files.set(
      `${KIGO_DIR}/2026-08-20-by-hand.md`,
      ["---", "id: k_ffffff", "created: 2026-08-20", "---", "# written in an editor", ""].join("\n"),
    );
    const index = await store.index();
    expect(index.entries.map((e) => e.id)).toContain("k_ffffff");
    expect(index.entries.find((e) => e.id === "k_ffffff")?.season).toBe("autumn/early");
  });
});

describe("reading a directory someone has been editing", () => {
  it("sorts by the day the kigo was recorded", async () => {
    const { store } = fresh();
    await store.create({ ...DRAFT, text: "third", created: "2026-11-08" });
    await store.create({ ...DRAFT, text: "first", created: "2026-02-11" });
    await store.create({ ...DRAFT, text: "second", created: "2026-05-09" });
    expect((await store.all()).map((k) => k.text)).toEqual(["first", "second", "third"]);
  });

  // One typo in one file must not take the diary down with it.
  it("reports a file it cannot read and carries on with the rest", async () => {
    const { io, store } = fresh();
    await store.create(DRAFT);
    io.files.set(`${KIGO_DIR}/2026-03-01-broken.md`, "not a kigo at all\n");

    const { entries, problems } = await store.scan();
    expect(entries).toHaveLength(1);
    expect(problems).toEqual([
      { path: `${KIGO_DIR}/2026-03-01-broken.md`, message: expect.stringMatching(/frontmatter/) },
    ]);
  });

  it("ignores anything that is not a kigo file", async () => {
    const { io, store } = fresh();
    await store.create(DRAFT);
    io.files.set(`${KIGO_DIR}/notes.txt`, "shopping list");
    io.files.set("README.md", "# not a kigo");
    expect(await store.all()).toHaveLength(1);
    expect((await store.scan()).problems).toEqual([]);
  });
});

describe("a file written by a later version", () => {
  const FUTURE = [
    "---",
    "schema: 2",
    "id: k_ffff01",
    "created: 2026-02-11",
    "season: spring/early",
    "category: humanity",
    'paper: "#c94f3d"',
    "touched: []",
    "wing-count: 6",
    "---",
    "# something this build has never seen",
    "",
  ].join("\n");

  it("is read, touched, and written back without being downgraded", async () => {
    const io = createMemoryIO({ [`${KIGO_DIR}/2026-02-11-future.md`]: FUTURE });
    const store = createStore(io, { newId: counter() });

    await store.touch("k_ffff01", "2026-03-02");
    const written = io.files.get(`${KIGO_DIR}/2026-02-11-future.md`)!;
    expect(written).toContain("schema: 2");
    expect(written).toContain("wing-count: 6");
    expect(parseKigo(written).touched).toEqual(["2026-03-02"]);
  });
});

describe("the migration hook", () => {
  const at = (schema: number): Kigo => ({
    schema,
    id: "k_000001",
    created: "2026-02-11",
    season: "spring/early",
    category: "humanity",
    paper: "#c94f3d",
    touched: [],
    text: "a line",
    verses: [],
  });

  it("does nothing today, because there is only version 1", () => {
    expect(applyMigrations(at(1))).toEqual(at(1));
  });

  // Version 1 is the only one that exists, so the machinery is proven against a
  // made-up version 2 rather than left untested until the day it is needed.
  it("runs each step in turn when there is somewhere to go", () => {
    const migrations = {
      1: (k: Kigo): Kigo => ({ ...k, schema: 2, text: `${k.text} (v2)` }),
      2: (k: Kigo): Kigo => ({ ...k, schema: 3, text: `${k.text} (v3)` }),
    };
    const out = applyMigrations(at(1), migrations, 3);
    expect(out.schema).toBe(3);
    expect(out.text).toBe("a line (v2) (v3)");
  });

  it("refuses to guess when a step is missing", () => {
    expect(() => applyMigrations(at(1), {}, 2)).toThrow(/no migration/);
  });

  it("leaves a file from the future exactly as it found it", () => {
    expect(applyMigrations(at(9))).toEqual(at(9));
  });
});

describe("filenames", () => {
  it("reads like an almanac in a directory listing", () => {
    expect(slug("leaving my phone in the kitchen at dinner")).toBe(
      "leaving-my-phone-in-the-kitchen-at-dinner",
    );
    expect(slug("Walking — before the light goes!")).toBe("walking-before-the-light-goes");
    expect(slug("  spaced  out  ")).toBe("spaced-out");
  });

  it("keeps a language that does not use the latin alphabet", () => {
    expect(slug("朝の散歩")).toBe("朝の散歩");
  });

  it("falls back to the id when the text leaves nothing to work with", async () => {
    const { io, store } = fresh();
    await store.create({ ...DRAFT, text: "!!! ???" });
    expect([...io.files.keys()]).toContain(`${KIGO_DIR}/2026-02-11-000001.md`);
  });

  it("stays short enough to be a filename", () => {
    expect(slug("a".repeat(200)).length).toBeLessThanOrEqual(48);
  });
});

describe("the store stays inside its own two places", () => {
  it("never writes anywhere but kigo/ and index.json", async () => {
    const { io, store } = fresh();
    const made = await store.create({ ...DRAFT, text: "../../escape attempt" });
    await store.touch(made.id, "2026-03-02", "still true");
    await store.update(made.id, { text: "C:\\Windows\\System32" });
    for (const path of io.files.keys()) {
      expect(path === INDEX_PATH || path.startsWith(`${KIGO_DIR}/`)).toBe(true);
      expect(path).not.toContain("..");
      expect(path).not.toContain("\\");
    }
  });
});
