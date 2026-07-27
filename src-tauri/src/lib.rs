mod dev;
mod store;

#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            quit,
            dev::dev_flags,
            store::kigo_root,
            store::kigo_list,
            store::kigo_read,
            store::kigo_write_atomic,
            store::kigo_remove
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
