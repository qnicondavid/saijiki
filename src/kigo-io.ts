// The only door to the disk, and it is a narrow one.
//
// Four operations, no directory handles, no globs, no stat, no open file
// descriptors. Everything above this line is format and policy and can be
// tested with no filesystem at all; everything below it is Rust's problem.
// That split is deliberate: the store's real implementation resolves its root
// in Rust and refuses paths that leave it, so the frontend never holds general
// filesystem access — it holds these four verbs, scoped to one directory.
//
// Paths are store-root-relative and always POSIX ("kigo/2026-02-11-x.md"),
// on every platform. The Rust side does the joining.

export interface KigoIO {
  /** Every file the store owns, as store-root-relative paths. */
  list(): Promise<string[]>;
  /** The file's contents, or null if it is not there. Missing is not an error. */
  read(path: string): Promise<string | null>;
  /** Write via a temp file in the same directory, then rename over the target. */
  writeAtomic(path: string, contents: string): Promise<void>;
  /** Delete. Deleting what is already gone is not an error. */
  remove(path: string): Promise<void>;
}

// Kept in step with the check in src-tauri/src/store.rs. Having it on both
// sides means the in-memory implementation rejects exactly what the real one
// rejects, so a path bug shows up in a unit test rather than on someone's disk.
export function assertStorePath(path: string): void {
  const bad = (why: string): never => {
    throw new Error(`unsafe store path (${why}): ${JSON.stringify(path)}`);
  };
  if (typeof path !== "string" || path.length === 0) bad("empty");
  if (path.includes("\\")) bad("backslash");
  for (const ch of path) if (ch.codePointAt(0)! < 0x20) bad("control character");
  if (path.includes(":")) bad("drive or stream");
  if (path.startsWith("/")) bad("absolute");
  if (path.endsWith("/")) bad("directory");
  for (const part of path.split("/")) {
    if (part === "") bad("empty segment");
    if (part === "." || part === "..") bad("relative segment");
  }
}

export interface MemoryIO extends KigoIO {
  /** The whole store, for tests to inspect, corrupt, and hand-build. */
  files: Map<string, string>;
  /** Make the next write to `path` fail once — the disposable-index test. */
  failWrite(path: string, times?: number): void;
}

/**
 * The second implementation, in memory. This is what the suite runs against:
 * no temp directories, no cleanup, no chance of a test finding its way to the
 * user's real store.
 */
export function createMemoryIO(initial: Record<string, string> = {}): MemoryIO {
  const files = new Map<string, string>(Object.entries(initial));
  const failures = new Map<string, number>();

  return {
    files,
    failWrite(path, times = 1) {
      failures.set(path, times);
    },
    async list() {
      return [...files.keys()];
    },
    async read(path) {
      assertStorePath(path);
      return files.get(path) ?? null;
    },
    async writeAtomic(path, contents) {
      assertStorePath(path);
      const left = failures.get(path) ?? 0;
      if (left > 0) {
        failures.set(path, left - 1);
        throw new Error(`refusing to write ${path} (test)`);
      }
      files.set(path, contents);
    },
    async remove(path) {
      assertStorePath(path);
      files.delete(path);
    },
  };
}
