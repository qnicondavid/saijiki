//! The dev switches, read off the command line.
//!
//! The first two exist so that year-three state is inspectable on day one,
//! which is the whole reason the harness exists:
//!
//!   --store=dev          talk to saijiki-dev instead of the user's diary
//!   --today=YYYY-MM-DD   render as of that day, and stop consulting the machine
//!   --icon               draw the app's own icon and exit (npm run icon)
//!
//! The first two survive into a release build on purpose: a shipped copy can
//! still be pointed at the synthetic store for a demo without going anywhere
//! near the diary, and neither can select the real store — that is what doing
//! nothing selects. The third does nothing in a release build, because the
//! command it would ask for is not compiled into one.
//!
//! They are command-line rather than environment because that is what survives
//! `npm run tauri dev -- -- --store=dev` on all three platforms without a
//! cross-env dependency, and because an argument is visible in the process list
//! when you are trying to work out why the widget is showing next March.
//!
//! Reading `--today` here rather than in the webview keeps the shape of the
//! thing honest: it is a flag on the program, and the frontend asks the program
//! what it was started with. The date is passed through as written — validating
//! it is the calendar's job, and seasons.ts already refuses a date that does not
//! exist, loudly, in one place.
//!
//! Neither switch can select the real store. `--store=dev` moves *to* the dev
//! one; the real one is what you get by doing nothing, which is the only way it
//! is ever chosen.

use crate::store;

#[derive(serde::Serialize)]
pub struct DevFlags {
    /// "dev" or "real". A name, never a path — the path contains a username and
    /// this ends up on a debug overlay that ends up in a screenshot.
    pub store: &'static str,
    pub today: Option<String>,
    /// Draw the icon set and quit, instead of being a widget. Only ever true in
    /// a debug build — see icon.rs and src/icon-forge.ts.
    pub icon: bool,
}

fn flag_value(name: &str) -> Option<String> {
    let prefix = format!("{name}=");
    std::env::args().find_map(|a| a.strip_prefix(&prefix).map(str::to_owned))
}

fn flag(name: &str) -> bool {
    std::env::args().any(|a| a == name)
}

#[tauri::command]
pub fn dev_flags() -> DevFlags {
    DevFlags {
        store: if store::is_dev_store() { "dev" } else { "real" },
        today: flag_value("--today"),
        icon: cfg!(debug_assertions) && flag("--icon"),
    }
}
