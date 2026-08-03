// Build the app's icon set out of the app.
//
//   npm run icon
//
// Three steps, in this order, because each one needs the last:
//
//   1. Run the widget with `--icon`. It draws itself — one butterfly on the
//      diorama, through the same renderer and the same webview engine as the
//      real thing — at each size, and hands the PNGs to a debug-only Rust
//      command that drops them in src-tauri/icons/rendered/. See
//      src/icon-forge.ts for why each size is drawn rather than downscaled.
//   2. Run `tauri icon` over the largest. It is the only thing that can make an
//      .ico and an .icns, and it can only make them from one square source.
//   3. Put the drawn PNGs back over the three that step 2 downscaled. Those
//      three are what tauri.conf.json's bundle.icon list actually ships, and a
//      32px butterfly drawn at 32px is a different picture from a 1024px one
//      squeezed into 32 — which is the whole reason step 1 draws four.
//
// The .ico keeps step 2's downscales inside it. That is the one place the
// level-of-detail work cannot reach, and it is where Windows looks.
//
// This is a dev script and it says so loudly if it is run against a release
// binary: `--icon` is only ever true in a debug build.

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
const icons = join(root, "src-tauri", "icons");
const rendered = join(icons, "rendered");

// Which drawn size lands on which of Tauri's names. 1024 is missing on purpose:
// it is the source, not a shipped file.
const SHIPPED = [
  ["32.png", "32x32.png"],
  ["128.png", "128x128.png"],
  ["256.png", "128x128@2x.png"],
];

const SOURCE = "1024.png";

// Its own vite, on its own port. `npm run icon` is a build step, not a session:
// it should not fail because a dev server is already up, and it should not take
// one over either — the widget it starts writes four PNGs and quits, and a
// running `tauri dev` next to it must be left exactly as it was.
const PORT = 1425;

function run(args) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root,
      stdio: "inherit",
    });
    child.on("error", fail);
    child.on("exit", (code) =>
      code === 0 ? done() : fail(new Error(`tauri ${args[0]} exited with ${code}`)),
    );
  });
}

mkdirSync(rendered, { recursive: true });

console.log("\n[icon] 1/3 · drawing the icon with the app's own renderer\n");
// Two `--` before the flag: the first hands off from the tauri CLI to cargo,
// the second from cargo to the binary. Same shape as `npm run dev:store`.
await run([
  "dev",
  "--no-watch",
  "--config",
  JSON.stringify({
    build: {
      beforeDevCommand: `npx vite --port ${PORT} --strictPort`,
      devUrl: `http://localhost:${PORT}`,
    },
  }),
  "--",
  "--",
  "--icon",
]);

const source = join(rendered, SOURCE);
if (!existsSync(source)) {
  throw new Error(
    `the app did not write ${source}. It only draws the icon in a debug build — ` +
      "check the console output above for what it said instead.",
  );
}

console.log(`\n[icon] 2/3 · tauri icon, over ${SOURCE}\n`);
await run(["icon", source, "--output", icons]);

console.log("\n[icon] 3/3 · putting the drawn sizes back over the downscales\n");
for (const [from, to] of SHIPPED) {
  const src = join(rendered, from);
  if (!existsSync(src)) throw new Error(`missing ${src}`);
  copyFileSync(src, join(icons, to));
  console.log(`  ${to.padEnd(16)} ${(statSync(src).size / 1024).toFixed(1)} KB, drawn at size`);
}
console.log(`  icon.ico         downscaled from ${SOURCE} by tauri icon`);

// `tauri icon` also writes two mipmap trees for platforms this app does not
// have and, per CLAUDE.md, is not: a frameless always-on-top desktop widget
// parked in a screen corner. Forty launcher icons for an Android project that
// does not exist is forty files to explain to the next person.
for (const mobile of ["android", "ios"]) {
  rmSync(join(icons, mobile), { recursive: true, force: true });
}

console.log("\n[icon] done.\n");
