//! The two dev switches, read off the command line.
//!
//! Both exist so that year-three state is inspectable on day one, which is the
//! whole reason the harness exists:
//!
//!   --store=dev          talk to saijiki-dev instead of the user's diary
//!   --today=YYYY-MM-DD   render as of that day, and stop consulting the machine
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
}

fn flag_value(name: &str) -> Option<String> {
    let prefix = format!("{name}=");
    std::env::args().find_map(|a| a.strip_prefix(&prefix).map(str::to_owned))
}

#[tauri::command]
pub fn dev_flags() -> DevFlags {
    DevFlags {
        store: if store::is_dev_store() { "dev" } else { "real" },
        today: flag_value("--today"),
    }
}
