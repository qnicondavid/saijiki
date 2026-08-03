//! Starting with the session, if asked. Off unless it is.
//!
//! An ambient widget that has to be launched by hand every morning is one that
//! is not there on the mornings it matters, so the option exists. It is off by
//! default and it lives as one checkable line in the right-click menu, because
//! that menu is the whole of this app's settings surface and a preferences
//! window for a single boolean would be a worse thing than the boolean.
//!
//! The plugin registers the *current* executable, with whatever arguments it is
//! told to pass on. It is told to pass none, deliberately: `--store=dev` must
//! never end up in a login entry, or a machine would quietly come up every
//! morning showing a hundred and fifty synthetic butterflies instead of the
//! diary.
//!
//! `supported` is false in a debug build, and the menu leaves the item out
//! entirely when it is. A registry entry pointing at `target/debug/saijiki.exe`
//! would launch, find no vite dev server on 1420, and show an empty window every
//! login — and it would keep doing that after the binary had been deleted. The
//! toggle is a thing for an installed copy.

use tauri::{AppHandle, Runtime};
use tauri_plugin_autostart::ManagerExt;

#[derive(serde::Serialize)]
pub struct Autostart {
    /// Whether to offer it at all. See the note above about debug builds.
    pub supported: bool,
    pub enabled: bool,
    /// What the menu line should say, which is a different sentence per
    /// platform — Windows starts *with Windows*, macOS starts *at login*.
    pub label: &'static str,
}

const LABEL: &str = if cfg!(target_os = "windows") {
    "Start with Windows"
} else if cfg!(target_os = "macos") {
    "Start at login"
} else {
    "Start with the session"
};

#[tauri::command]
pub fn autostart_status<R: Runtime>(app: AppHandle<R>) -> Autostart {
    let supported = !cfg!(debug_assertions);
    Autostart {
        supported,
        // Asked rather than remembered: the user may have taken the entry out
        // from the other end (Task Manager's Startup tab, or the registry), and
        // a menu that disagreed with the machine would be worse than no menu.
        enabled: supported && app.autolaunch().is_enabled().unwrap_or(false),
        label: LABEL,
    }
}

#[tauri::command]
pub fn autostart_set<R: Runtime>(app: AppHandle<R>, enabled: bool) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Err("autostart is only offered by an installed build".into());
    }
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|e| e.to_string())
    } else {
        manager.disable().map_err(|e| e.to_string())
    }
}
