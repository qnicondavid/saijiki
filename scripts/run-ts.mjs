// Run one TypeScript file under Node, by bundling it first.
//
// Node 24 can strip types on its own, but only from files whose relative
// imports carry a `.ts` extension — and this project's source does not, because
// Vite resolves them. Adding extensions everywhere to suit a dev script would
// be the tail wagging the dog, and adding tsx or ts-node would be a dependency
// for one command. esbuild is already here (it is what Vite runs on), it
// resolves the project's imports exactly as Vite does, and it is fast enough
// that this is invisible.
//
// The bundle goes to the OS temp directory, never into the repo.

import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const entry = process.argv[2];
if (!entry) {
  console.error("usage: node scripts/run-ts.mjs <entry.ts> [args...]");
  process.exit(2);
}

const bundled = await build({
  entryPoints: [resolve(entry)],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  write: false,
  logLevel: "warning",
});

const dir = mkdtempSync(join(tmpdir(), "saijiki-run-"));
const file = join(dir, "bundle.mjs");
writeFileSync(file, bundled.outputFiles[0].text);

// Hand the script its own argv, so it sees the flags it was given and not the
// runner that is standing in front of it.
process.argv = [process.argv[0], resolve(entry), ...process.argv.slice(3)];

try {
  await import(pathToFileURL(file).href);
} finally {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* a temp file we could not delete is not worth failing a seed over */
  }
}
