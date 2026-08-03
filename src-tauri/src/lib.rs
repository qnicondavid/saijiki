mod autostart;
mod dev;
#[cfg(debug_assertions)]
mod icon;
mod store;

use tauri::Manager;

#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

/// Where the widget goes the very first time, when there is nothing to restore:
/// the lower-right corner of the primary screen, a little in from the edges.
///
/// CLAUDE.md says the window is "parked in a screen corner", and until now the
/// config said `center: true` — which is a different thing, and which had to
/// come out because it fights the window-state plugin. With both of them asking,
/// the widget sometimes opened in the middle of the screen rather than where it
/// had been left, which is the one thing it must not do.
///
/// So the centring is replaced by a corner, and by a corner that is only chosen
/// once: the existence of the plugin's own file is the question "has this
/// machine ever put the widget somewhere?", and it is asked before the plugin
/// has had any reason to write one.
fn park_on_first_run<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    const INSET: f64 = 24.0;

    let remembered = app
        .path()
        .app_config_dir()
        .map(|dir| dir.join(".window-state.json").exists())
        .unwrap_or(false);
    if remembered {
        return;
    }

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let (Ok(Some(screen)), Ok(size)) = (window.primary_monitor(), window.outer_size()) else {
        return;
    };

    // The work area rather than the whole monitor, so the widget does not park
    // underneath the taskbar.
    let area = screen.work_area();
    let inset = (INSET * screen.scale_factor()).round() as i32;
    let x = area.position.x + area.size.width as i32 - size.width as i32 - inset;
    let y = area.position.y + area.size.height as i32 - size.height as i32 - inset;
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    // First, and before anything has opened a window or read a file. A second
    // copy has to decide whether it is a second copy before it becomes one.
    //
    // The guard is on the *real* store only, and that is the whole reason it
    // exists: two processes writing one diary is the failure being prevented,
    // and a copy running against saijiki-dev is not writing to the diary. So a
    // seeded demo can sit on the desktop beside the real widget — which is the
    // point of `--store=dev` surviving into a release build — while a second
    // real one simply hands the focus back to the first.
    #[cfg(desktop)]
    if !store::is_dev_store() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // No notification, no toast, nothing that announces itself: the
            // whole event is the window the user already has coming forward.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    builder = builder
        // Position only, never size.
        //
        // The widget is a postcard and is the same postcard forever; the only
        // things in this codebase that ever ask for another size are the dev
        // gallery and the tuning panel, which borrow the window and hand it
        // back. But dev and release share one identifier and therefore one
        // .window-state.json, so a dev session that ended with the panel open
        // wrote 1120x640 into the file the *shipped* widget reads at startup —
        // and the shipped widget, which has no panel and no way to close one,
        // simply came up stretched across a third of the screen.
        //
        // There is no size worth remembering here. Dropping it from the flags
        // removes the whole class of bug rather than tidying up after it.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(tauri_plugin_window_state::StateFlags::POSITION)
                .build(),
        )
        // The window closing is the app quitting, said out loud.
        //
        // It was not. Alt+F4 destroyed the widget and left the process running
        // with nothing on screen — something in the window stack outlives the
        // one window this app has, and it has always done so. That was merely
        // untidy until the single-instance guard above went in; now an
        // invisible process holds the lock, and every relaunch quietly hands
        // the focus to a window that is not there. The user's diary would
        // simply refuse to open, with nothing to see and nothing to click.
        //
        // `Destroyed` rather than `CloseRequested`, so the window state has
        // already been written down by the time this asks the app to leave.
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) && window.label() == "main" {
                window.app_handle().exit(0);
            }
        });

    // `None` is load-bearing: no arguments are carried into the login entry, so
    // a machine that starts saijiki in the morning starts it on the diary and
    // never on the synthetic store. See autostart.rs.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ));
    }

    let builder = builder.setup(|app| {
        park_on_first_run(app.handle());
        Ok(())
    });

    // The command list, in two spellings. `generate_handler!` needs every name
    // at the macro call, so the dev-only one cannot be `#[cfg]`'d into the
    // middle of a shared list — a release build has to expand a list that does
    // not mention it at all. That is what makes `dev_write_icon` *absent* from
    // a shipped binary rather than merely refusing.
    #[cfg(debug_assertions)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        quit,
        dev::dev_flags,
        autostart::autostart_status,
        autostart::autostart_set,
        icon::dev_write_icon,
        store::kigo_root,
        store::kigo_list,
        store::kigo_read,
        store::kigo_write_atomic,
        store::kigo_remove
    ]);
    #[cfg(not(debug_assertions))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        quit,
        dev::dev_flags,
        autostart::autostart_status,
        autostart::autostart_set,
        store::kigo_root,
        store::kigo_list,
        store::kigo_read,
        store::kigo_write_atomic,
        store::kigo_remove
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
