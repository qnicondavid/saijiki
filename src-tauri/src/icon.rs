//! The disk half of `npm run icon`. Debug builds only — the whole module is
//! `#[cfg(debug_assertions)]` at its use site, so a shipped binary has no
//! command that writes into a source tree, whatever the webview asks for.
//!
//! The app draws its own icon (see src/icon-forge.ts), which means the pixels
//! come out of the same renderer that draws the widget, in the same webview
//! engine that will draw it on the user's machine. What it cannot do from
//! inside a webview is put a file next to the crate, so it hands the PNG bytes
//! here.
//!
//! The destination is `CARGO_MANIFEST_DIR/icons/rendered`, resolved at compile
//! time. That is the only path this can write to: the name is checked to be a
//! bare `*.png` with no separators and no `..`, so the webview chooses the file
//! but never the directory.

use std::fs;
use std::path::PathBuf;

fn dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("icons")
        .join("rendered")
}

#[tauri::command]
pub fn dev_write_icon(name: String, png: Vec<u8>) -> Result<String, String> {
    if !name.ends_with(".png")
        || name.len() > 64
        || name.contains(['/', '\\', ':'])
        || name.starts_with('.')
    {
        return Err(format!("not a plain png filename: {name}"));
    }
    let dir = dir();
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    let path = dir.join(&name);
    fs::write(&path, &png).map_err(|e| format!("cannot write {}: {e}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}
