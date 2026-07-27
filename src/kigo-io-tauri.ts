// The real KigoIO: four Tauri commands, and no filesystem plugin anywhere.
//
// Nothing in this file decides where the store lives or whether a path is
// allowed — Rust does both, every time, and would do so even if this file were
// replaced wholesale by something running in the webview. The check here is a
// courtesy that fails fast with a better message; it is not the defence.
//
// Not wired into the app yet: step 5 does that. It exists now so the seam has
// two implementations and the in-memory one cannot quietly drift into being
// the only shape the store knows how to talk to.

import { invoke } from "@tauri-apps/api/core";
import { assertStorePath, type KigoIO } from "./kigo-io";

export function createTauriIO(): KigoIO {
  return {
    list() {
      return invoke<string[]>("kigo_list");
    },
    read(path) {
      assertStorePath(path);
      return invoke<string | null>("kigo_read", { path });
    },
    writeAtomic(path, contents) {
      assertStorePath(path);
      return invoke<void>("kigo_write_atomic", { path, contents });
    },
    remove(path) {
      assertStorePath(path);
      return invoke<void>("kigo_remove", { path });
    },
  };
}

/** Where the store resolved to, for the dev harness to check before seeding. */
export function storeRoot(): Promise<string> {
  return invoke<string>("kigo_root");
}
