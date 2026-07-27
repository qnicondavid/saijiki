// Which store a path is, decided by reading the path.
//
// The seeder writes a hundred and fifty fake entries, and the only thing
// standing between that and someone's diary is this file. So the check does not
// ask whether an environment variable was set, or whether a flag was passed, or
// whether the caller meant well: it takes the root that was actually resolved,
// looks at the directory it ends in, and refuses anything that is not exactly
// `saijiki-dev`.
//
// That distinction is the whole point. "SAIJIKI_STORE was set" is a statement
// about intent; "this path ends in saijiki-dev" is a statement about where the
// bytes are going to land. Only the second one survives a typo in an npm
// script, a shell that swallowed the variable, or a future refactor that moves
// the resolution somewhere else.
//
// It fails closed in every ambiguous case. `saijiki` is refused because it is
// the real store; `Saijiki-Dev` is refused because it is not the name this code
// builds; anything else is refused because it is not a store at all. There is no
// input to this module that turns a refusal into an acceptance.

export const REAL_STORE_DIR = "saijiki";
export const DEV_STORE_DIR = "saijiki-dev";

/**
 * The last path segment, with separators of either kind and any number of
 * trailing ones. Windows paths arrive with backslashes and POSIX ones with
 * slashes, and a root that came from joining strings may well have both.
 */
export function storeDirName(root: string): string {
  const trimmed = root.replace(/[/\\]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return cut < 0 ? trimmed : trimmed.slice(cut + 1);
}

export function isDevStoreRoot(root: string): boolean {
  return storeDirName(root) === DEV_STORE_DIR;
}

export function isRealStoreRoot(root: string): boolean {
  return storeDirName(root) === REAL_STORE_DIR;
}

/**
 * Throw unless `root` is the dev store. The message names the two directories
 * rather than printing the path, because the path contains a username and this
 * runs in a terminal that gets pasted into issues.
 */
export function assertDevStoreRoot(root: string, what = "this operation"): void {
  if (isDevStoreRoot(root)) return;
  const found = storeDirName(root) || "(nothing)";
  throw new Error(
    `refusing to run ${what}: the store resolved to a directory named ` +
      `"${found}", and only "${DEV_STORE_DIR}" is allowed. ` +
      (isRealStoreRoot(root)
        ? "That is the real store — it holds someone's diary and nothing here may touch it."
        : `Pass SAIJIKI_STORE=dev, or --store=dev, so the root resolves to ${DEV_STORE_DIR}.`),
  );
}

/** `<dataDir>/saijiki` or `<dataDir>/saijiki-dev`. The join is POSIX-safe on Windows too. */
export function storeRootIn(dataDir: string, flavour: "real" | "dev"): string {
  const base = dataDir.replace(/[/\\]+$/, "");
  const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return `${base}${sep}${flavour === "dev" ? DEV_STORE_DIR : REAL_STORE_DIR}`;
}
