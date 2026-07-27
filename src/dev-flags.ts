// What the program was started with, as far as the webview is concerned.
//
//   npm run dev:store                          the synthetic store, today
//   npm run dev:store -- --today=2029-03-01    the synthetic store, three years on
//
// (`dev:store` rather than `tauri dev` because npm swallows one `--` and the
// tauri CLI wants two before an argument reaches the app itself.)
//
// Both flags are parsed in Rust (src-tauri/src/dev.rs), because that is where
// the command line is and because the store one has to be decided before any
// path is resolved. This side only asks.
//
// `store` is a name and never a path. The overlay shows it — that is most of
// what it is for, since "am I looking at the dev store?" is a question worth
// answering at a glance — and a path would put a username in a screenshot.

import { invoke } from "@tauri-apps/api/core";

export interface DevFlags {
  store: "dev" | "real";
  /** `--today=YYYY-MM-DD`, or null for the machine's own date. */
  today: string | null;
}

const SHIPPED: DevFlags = { store: "real", today: null };

export async function readDevFlags(): Promise<DevFlags> {
  try {
    return await invoke<DevFlags>("dev_flags");
  } catch (error) {
    // Not running under Tauri, or an older binary without the command. Fail to
    // the shipped configuration: the real store, the real date, no dev anything.
    console.warn("[dev] could not read the command line; assuming a shipped build.", error);
    return SHIPPED;
  }
}
