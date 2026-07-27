// The guard that stands between a hundred and fifty fake entries and someone's
// diary. It is one string comparison, which is why it gets this many tests: the
// failure mode is silent, irreversible, and lands in a public repository.
//
// Every case here asks the same question in a different way — does the check
// fail *closed*? A guard that is merely usually right is not a guard.

import { describe, expect, it } from "vitest";
import {
  assertDevStoreRoot,
  isDevStoreRoot,
  isRealStoreRoot,
  storeDirName,
  storeRootIn,
} from "./store-root";

describe("reading the store's name off its path", () => {
  it("reads the last segment, whichever separator built the path", () => {
    expect(storeDirName("C:\\Users\\somebody\\AppData\\Roaming\\saijiki-dev")).toBe("saijiki-dev");
    expect(storeDirName("/home/somebody/.local/share/saijiki-dev")).toBe("saijiki-dev");
    expect(storeDirName("/Users/somebody/Library/Application Support/saijiki")).toBe("saijiki");
    // a path built by joining strings can end up with both kinds
    expect(storeDirName("C:\\Users\\somebody/AppData/Roaming/saijiki-dev")).toBe("saijiki-dev");
  });

  it("ignores trailing separators", () => {
    expect(storeDirName("/home/x/.local/share/saijiki-dev/")).toBe("saijiki-dev");
    expect(storeDirName("C:\\Users\\x\\AppData\\Roaming\\saijiki-dev\\\\")).toBe("saijiki-dev");
  });

  it("copes with a path that is only a name", () => {
    expect(storeDirName("saijiki-dev")).toBe("saijiki-dev");
    expect(storeDirName("")).toBe("");
  });
});

describe("the dev-store guard", () => {
  const dev = "C:\\Users\\somebody\\AppData\\Roaming\\saijiki-dev";
  const real = "C:\\Users\\somebody\\AppData\\Roaming\\saijiki";

  it("accepts the dev store", () => {
    expect(isDevStoreRoot(dev)).toBe(true);
    expect(() => assertDevStoreRoot(dev)).not.toThrow();
    expect(isDevStoreRoot("/home/x/.local/share/saijiki-dev")).toBe(true);
    expect(isDevStoreRoot("/Users/x/Library/Application Support/saijiki-dev")).toBe(true);
  });

  it("refuses the real store, and says why", () => {
    expect(isDevStoreRoot(real)).toBe(false);
    expect(isRealStoreRoot(real)).toBe(true);
    expect(() => assertDevStoreRoot(real)).toThrow(/diary/);
  });

  // Every one of these is a plausible near-miss, and every one has to fail
  // closed. The check is equality against a name this code builds itself, so
  // there is nothing to be clever about — but "saijiki-development" and
  // "my-saijiki-dev" are exactly the shapes a looser check would let through.
  it("refuses everything that merely resembles the dev store", () => {
    for (const near of [
      "C:\\Users\\x\\AppData\\Roaming\\saijiki-development",
      "C:\\Users\\x\\AppData\\Roaming\\my-saijiki-dev",
      "C:\\Users\\x\\AppData\\Roaming\\saijiki-dev-old",
      "C:\\Users\\x\\AppData\\Roaming\\saijiki-dev.bak",
      "C:\\Users\\x\\AppData\\Roaming\\Saijiki-Dev", // the name is built lowercase
      "C:\\Users\\x\\AppData\\Roaming\\SAIJIKI",
      "C:\\Users\\x\\AppData\\Roaming\\saijiki-dev\\kigo", // a directory inside it is not it
      "C:\\saijiki", // the project folder, which is public
      "C:\\saijiki\\src",
      "",
      ".",
      "/",
    ]) {
      expect(isDevStoreRoot(near), near).toBe(false);
      expect(() => assertDevStoreRoot(near), near).toThrow();
    }
  });

  it("names the operation it is refusing", () => {
    expect(() => assertDevStoreRoot(real, "the seeder")).toThrow(/the seeder/);
  });

  it("does not print the path it refused", () => {
    // The path has a username in it and this message goes to a terminal that
    // gets pasted into issues.
    try {
      assertDevStoreRoot(real);
      throw new Error("should have refused");
    } catch (error) {
      expect(String(error)).not.toContain("somebody");
      expect(String(error)).not.toContain("AppData");
    }
  });
});

describe("building a store root", () => {
  it("keeps the platform's own separator", () => {
    expect(storeRootIn("C:\\Users\\x\\AppData\\Roaming", "dev")).toBe(
      "C:\\Users\\x\\AppData\\Roaming\\saijiki-dev",
    );
    expect(storeRootIn("/home/x/.local/share", "real")).toBe("/home/x/.local/share/saijiki");
  });

  it("produces roots its own guard agrees with", () => {
    for (const dataDir of ["C:\\Users\\x\\AppData\\Roaming", "/home/x/.local/share"]) {
      expect(isDevStoreRoot(storeRootIn(dataDir, "dev"))).toBe(true);
      expect(isDevStoreRoot(storeRootIn(dataDir, "real"))).toBe(false);
    }
  });
});
