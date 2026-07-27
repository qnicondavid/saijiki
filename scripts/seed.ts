// The seeder. It writes a hundred and fifty fake kigo, and it writes them to
// exactly one place.
//
//   npm run seed                    150 entries, as of today
//   npm run seed -- --today=2029-03-01 --count=40 --seed=7
//   npm run seed:clear              take them all out again
//
// --- the guard --------------------------------------------------------------
//
// This repository is public and the user's entries are a private diary. So the
// first thing that happens here is that the store root is *resolved*, and the
// resolved path is then read: unless the directory it ends in is called
// `saijiki-dev`, nothing else in this file runs.
//
// That is deliberately not the same as checking that SAIJIKI_STORE was set. An
// environment variable is a statement about what someone meant; a path is a
// statement about where the bytes are going to land, and only the second one
// survives a typo in an npm script, a shell that swallowed the variable, or a
// future refactor that moves the resolution somewhere else. There is no flag,
// no variable and no argument to this script that can make it write to
// `saijiki`. See src/store-root.ts, which is where the check lives and is
// tested.
//
// --- and the roots ----------------------------------------------------------
//
// These have to agree with `app.path().data_dir()` in src-tauri/src/store.rs,
// because the whole point is that the app then reads what this wrote. Tauri's
// data_dir is the `dirs` crate's, which is:
//
//   Windows  %APPDATA%                        (FOLDERID_RoamingAppData)
//   macOS    ~/Library/Application Support
//   Linux    $XDG_DATA_HOME, or ~/.local/share

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, sep } from "node:path";

import { systemToday } from "../src/clock";
import { serialiseKigo } from "../src/kigo-format";
import { assertStorePath, type KigoIO } from "../src/kigo-io";
import { planSeed, summaryLines } from "../src/seed-plan";
import { toISODate } from "../src/seasons";
import { assertDevStoreRoot, storeRootIn } from "../src/store-root";
import { createStore, pathFor } from "../src/store";

// --- where ------------------------------------------------------------------

function dataDir(): string {
  if (process.platform === "win32") {
    const roaming = process.env.APPDATA;
    if (!roaming) throw new Error("no %APPDATA% in the environment: cannot find the app data directory");
    return roaming;
  }
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support");
  return process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
}

/** The path with the home directory folded back to `~`, for printing. */
function tidy(path: string): string {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

// --- the disk ---------------------------------------------------------------

/**
 * A KigoIO over Node's fs, with the same two rules the Rust one has: every path
 * is store-root-relative and POSIX, and every path is checked before it is
 * joined to anything. `assertStorePath` is the same function the in-memory
 * implementation uses, so this refuses exactly what the app refuses.
 */
function createNodeIO(root: string): KigoIO {
  assertDevStoreRoot(root, "the seeder");

  const full = (path: string): string => {
    assertStorePath(path);
    // Re-read the root on every write. It cannot have changed — but this is the
    // one file in the project where being sure is worth three microseconds.
    assertDevStoreRoot(root, "the seeder");
    return join(root, ...path.split("/"));
  };

  return {
    async list() {
      return existsSync(root) ? walk(root, root, 0) : [];
    },
    async read(path) {
      const target = full(path);
      if (!existsSync(target)) return null;
      const { readFileSync } = await import("node:fs");
      return readFileSync(target, "utf8");
    },
    async writeAtomic(path, contents) {
      const target = full(path);
      mkdirSync(dirname(target), { recursive: true });
      const temp = `${target}.tmp-${process.pid}`;
      writeFileSync(temp, contents, "utf8");
      renameSync(temp, target);
    },
    async remove(path) {
      const target = full(path);
      if (existsSync(target)) unlinkSync(target);
    },
  };
}

function walk(root: string, dir: string, depth: number): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (depth < 2) out.push(...walk(root, path, depth + 1));
      continue;
    }
    out.push(relative(root, path).split(sep).join("/"));
  }
  return out.sort();
}

// --- the commands -----------------------------------------------------------

function flag(name: string): string | undefined {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found?.slice(name.length + 3);
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function clear(root: string, io: KigoIO): Promise<number> {
  const files = await io.list();
  for (const path of files) await io.remove(path);
  // The two directories themselves, so a cleared store is indistinguishable
  // from one that was never seeded.
  const kigoDir = join(root, "kigo");
  if (existsSync(kigoDir) && readdirSync(kigoDir).length === 0) rmSync(kigoDir, { recursive: true });
  return files.length;
}

async function main(): Promise<void> {
  const root = storeRootIn(dataDir(), "dev");

  // Before anything else, and by reading the path rather than trusting a flag.
  assertDevStoreRoot(root, "the seeder");

  const io = createNodeIO(root);
  const store = createStore(io);

  if (has("clear") || process.env.SAIJIKI_SEED_CLEAR === "1") {
    const removed = await clear(root, io);
    console.log(`cleared ${removed} file${removed === 1 ? "" : "s"} from ${tidy(root)}`);
    return;
  }

  const today = toISODate(flag("today") ?? systemToday());
  const count = Number(flag("count") ?? 150);
  const seedFlag = flag("seed");

  const existing = await io.list();
  if (existing.length > 0) {
    console.log(`clearing ${existing.length} file${existing.length === 1 ? "" : "s"} already in the dev store`);
    await clear(root, io);
  }

  const plan = planSeed({
    today,
    count,
    ...(seedFlag === undefined ? {} : { seed: Number(seedFlag) }),
  });

  mkdirSync(join(root, "kigo"), { recursive: true });
  const taken = new Map<string, string>();
  for (const kigo of plan.kigo) {
    const path = pathFor(kigo, taken);
    taken.set(path, kigo.id);
    await io.writeAtomic(path, serialiseKigo(kigo));
  }

  // Written by the store rather than by hand, so the cache the app reads is the
  // one the app would have produced.
  await store.rebuildIndex();

  console.log(`seeded ${tidy(root)}`);
  console.log("");
  for (const line of summaryLines(plan.summary)) console.log(line);
  console.log("");
  // `npm run dev:store` rather than `npm run tauri dev`, because npm swallows
  // one `--` and the tauri CLI wants two before an argument reaches the app.
  console.log(`to look at it:  npm run dev:store -- --today=${today}`);
}

await main();
