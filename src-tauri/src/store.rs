//! The disk half of the kigo store.
//!
//! The frontend gets four verbs and a root it cannot name. It never receives a
//! path from us and never gets to choose one that leaves the store: every path
//! that arrives here is store-root-relative, POSIX, and checked component by
//! component before it is joined to anything.
//!
//! Note there is no filesystem plugin in this app — not `tauri-plugin-fs`, not
//! a scoped variant of it. Tauri v2 capabilities gate plugin and core
//! permissions, so the way to keep general filesystem access away from the
//! webview is to never grant it in the first place and to let these four
//! commands be the only route to a file. That is what src-tauri/capabilities
//! deliberately does not list.
//!
//! The root:
//!   Windows  %APPDATA%\saijiki
//!   macOS    ~/Library/Application Support/saijiki
//!   Linux    ~/.local/share/saijiki   (or $XDG_DATA_HOME)
//! and `saijiki-dev` instead of `saijiki` when SAIJIKI_STORE=dev, which is how
//! the dev harness and the seeder stay off the user's real diary.

use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;

use tauri::{AppHandle, Manager, Runtime};

const REAL_DIR: &str = "saijiki";
const DEV_DIR: &str = "saijiki-dev";

/// How deep a store can nest. `kigo/x.md` is one level; the cap exists so a
/// stray symlink or a user's backup folder cannot turn a listing into a walk of
/// the whole drive.
const MAX_DEPTH: usize = 2;

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Which of the two stores this process is talking to.
///
/// Decided once and never revisited, because a store that could change flavour
/// mid-session is a store that could write half a seeding run into someone's
/// diary. Both switches only ever select *dev* — there is no input, from the
/// environment or the command line, that selects the real store, because the
/// real store is what you get by doing nothing.
pub fn is_dev_store() -> bool {
    store_dir_name() == DEV_DIR
}

fn store_dir_name() -> &'static str {
    static NAME: OnceLock<&'static str> = OnceLock::new();
    NAME.get_or_init(|| {
        let by_env = std::env::var("SAIJIKI_STORE")
            .map(|v| v.eq_ignore_ascii_case("dev"))
            .unwrap_or(false);
        let by_flag = std::env::args().any(|a| a == "--store=dev");
        if by_env || by_flag {
            DEV_DIR
        } else {
            REAL_DIR
        }
    })
}

fn store_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let data = app
        .path()
        .data_dir()
        .map_err(|e| format!("no app data directory: {e}"))?;
    Ok(data.join(store_dir_name()))
}

fn resolve<R: Runtime>(app: &AppHandle<R>, rel: &str) -> Result<PathBuf, String> {
    resolve_in(&store_root(app)?, rel)
}

/// Turn a store-relative path into an absolute one, or refuse.
///
/// Rejected: absolute paths, drive letters and UNC prefixes, `.` and `..` in
/// any position, backslashes (the interface is POSIX on every platform), empty
/// segments, and anything that would land outside the root once joined.
///
/// The root is a parameter rather than an `AppHandle` for one reason: this is
/// the function in this file where a bug is a security bug, and a guard that can
/// only be exercised by booting a Tauri app is a guard that does not get
/// exercised. See the tests at the bottom of the file.
fn resolve_in(root: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.is_empty() {
        return Err("empty path".into());
    }
    if rel.contains('\\') {
        return Err(format!("path must use / separators: {rel}"));
    }
    if rel.contains('\0') || rel.chars().any(|c| c.is_control()) {
        return Err(format!("path contains a control character: {rel}"));
    }
    if rel.starts_with('/') {
        return Err(format!("path must be relative: {rel}"));
    }
    if rel.ends_with('/') {
        return Err(format!("path is a directory: {rel}"));
    }

    // Read the raw text first, before `Path` gets a chance to tidy anything
    // away. `Path::components` normalises `//` and a mid-path `.` out of
    // existence, so a check written only against the component list would
    // quietly accept `kigo/./x.md` while kigo-io.ts rejects it — and the whole
    // value of having the check on both sides is that they reject the same set.
    for part in rel.split('/') {
        match part {
            "" => return Err(format!("path has an empty segment: {rel}")),
            "." | ".." => return Err(format!("path must be free of '.' and '..': {rel}")),
            _ => {}
        }
        if part.contains(':') {
            return Err(format!("path contains a drive or stream: {rel}"));
        }
    }

    // And then walk the components anyway. This is what catches whatever the
    // platform's own path parser sees that a `/`-split does not: a Windows
    // drive prefix, a UNC share, a verbatim `\\?\` path.
    let relative = Path::new(rel);
    for component in relative.components() {
        match component {
            Component::Normal(part) => {
                let part = part
                    .to_str()
                    .ok_or_else(|| format!("path is not valid UTF-8: {rel}"))?;
                if part.contains(':') {
                    return Err(format!("path contains a drive or stream: {rel}"));
                }
            }
            _ => return Err(format!("path must be relative and free of '..': {rel}")),
        }
    }

    let full = root.join(relative);
    if !full.starts_with(root) {
        return Err(format!("path escapes the store: {rel}"));
    }

    // The lexical check above cannot see a symlink pointing out of the store,
    // so where the parent already exists, compare the canonical forms too.
    if let (Ok(real_root), Some(parent)) = (fs::canonicalize(root), full.parent()) {
        if let Ok(real_parent) = fs::canonicalize(parent) {
            if !real_parent.starts_with(&real_root) {
                return Err(format!("path escapes the store through a link: {rel}"));
            }
        }
    }

    Ok(full)
}

fn walk(root: &Path, dir: &Path, depth: usize, out: &mut Vec<String>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("cannot read {}: {e}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("cannot read {}: {e}", dir.display()))?;
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        // Half-written temp files are ours and are nobody else's business.
        if name.starts_with('.') {
            continue;
        }
        let meta = match fs::symlink_metadata(&path) {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            if depth < MAX_DEPTH {
                walk(root, &path, depth + 1, out)?;
            }
            continue;
        }
        if let Ok(relative) = path.strip_prefix(root) {
            let posix: Vec<String> = relative
                .components()
                .filter_map(|c| match c {
                    Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
                    _ => None,
                })
                .collect();
            out.push(posix.join("/"));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn kigo_root<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    Ok(store_root(&app)?.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn kigo_list<R: Runtime>(app: AppHandle<R>) -> Result<Vec<String>, String> {
    let root = store_root(&app)?;
    let mut out = Vec::new();
    if root.is_dir() {
        walk(&root, &root, 0, &mut out)?;
    }
    out.sort();
    Ok(out)
}

#[tauri::command]
pub fn kigo_read<R: Runtime>(app: AppHandle<R>, path: String) -> Result<Option<String>, String> {
    let full = resolve(&app, &path)?;
    match fs::read_to_string(&full) {
        Ok(contents) => Ok(Some(contents)),
        // Missing is not an error: index.json may be gone at any moment.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("cannot read {path}: {e}")),
    }
}

/// Write a temp file beside the target, flush it, then rename over the target.
/// A crash mid-write leaves either the old file or the new one, never half of
/// either — these are someone's entries and there is no second copy.
#[tauri::command]
pub fn kigo_write_atomic<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    contents: String,
) -> Result<(), String> {
    let full = resolve(&app, &path)?;
    let parent = full
        .parent()
        .ok_or_else(|| format!("no directory for {path}"))?;
    fs::create_dir_all(parent).map_err(|e| format!("cannot create {}: {e}", parent.display()))?;

    let stem = full
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "kigo".into());
    let temp = parent.join(format!(
        ".{stem}.tmp-{}-{}",
        std::process::id(),
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));

    let write = || -> std::io::Result<()> {
        let mut file = fs::File::create(&temp)?;
        file.write_all(contents.as_bytes())?;
        file.sync_all()
    };
    if let Err(e) = write() {
        let _ = fs::remove_file(&temp);
        return Err(format!("cannot write {path}: {e}"));
    }

    if let Err(e) = fs::rename(&temp, &full) {
        let _ = fs::remove_file(&temp);
        return Err(format!("cannot replace {path}: {e}"));
    }
    Ok(())
}

#[tauri::command]
pub fn kigo_remove<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    let full = resolve(&app, &path)?;
    match fs::remove_file(&full) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("cannot remove {path}: {e}")),
    }
}

// --- the guard -------------------------------------------------------------
//
// `resolve_in` is the only function in this file where a bug is a security bug:
// everything else refuses to work if it is wrong, whereas this one quietly
// works on the wrong file. So it gets the tests.
//
// None of these go near either store. The root they are given does not exist,
// which is exactly the point — every rejection below is lexical, decided before
// a single syscall, and the one filesystem check `resolve_in` makes is skipped
// when the root cannot be canonicalised. The single test that does want a real
// directory builds its own under the OS temp dir.

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_root() -> PathBuf {
        std::env::temp_dir().join("saijiki-resolve-tests-no-such-root")
    }

    /// Assert a path is refused, and hand back the message so a test can say
    /// *why* it expected the refusal.
    fn reject(rel: &str) -> String {
        match resolve_in(&fake_root(), rel) {
            Ok(full) => panic!("resolve_in accepted {rel:?} and returned {}", full.display()),
            Err(message) => message,
        }
    }

    fn accept(rel: &str) -> PathBuf {
        resolve_in(&fake_root(), rel)
            .unwrap_or_else(|e| panic!("resolve_in refused the legitimate path {rel:?}: {e}"))
    }

    #[test]
    fn refuses_dot_dot_in_any_position() {
        reject("..");
        reject("../index.json");
        reject("kigo/..");
        reject("kigo/../index.json");
    }

    #[test]
    fn refuses_a_backslash_anywhere() {
        // The interface is POSIX on every platform, so a backslash is never a
        // separator here. That is also what stops `..\` from walking out of the
        // store on Windows by spelling itself the other way: it is refused for
        // the backslash before anything has to reason about the `..`.
        assert!(reject("..\\").contains("separators"));
        assert!(reject("..\\..\\index.json").contains("separators"));
        assert!(reject("kigo\\2026-02-11-x.md").contains("separators"));
        assert!(reject("\\\\server\\share\\x.md").contains("separators"));
    }

    #[test]
    fn refuses_absolute_paths() {
        reject("/");
        reject("/etc/passwd");
        reject("/index.json");
    }

    #[test]
    fn refuses_a_drive_letter_or_an_ntfs_stream() {
        // On Windows `C:/...` parses as a prefix component; on Linux it parses
        // as a normal segment containing a colon. Both are refused, so the test
        // means the same thing on either platform.
        reject("C:/Windows/System32/config/SAM");
        reject("C:/saijiki/kigo/x.md");
        reject("foo:stream");
        reject("kigo/2026-02-11-x.md:Zone.Identifier");
    }

    #[test]
    fn refuses_traversal_that_would_only_escape_once_joined() {
        // The dangerous shape: every segment looks ordinary on its own, and the
        // path only leaves the store after `root.join` collapses it.
        reject("a/../../b");
        reject("kigo/../../saijiki/kigo/2026-02-11-real.md");
    }

    #[test]
    fn refuses_the_empty_path() {
        assert!(reject("").contains("empty"));
    }

    #[test]
    fn refuses_control_characters() {
        reject("kigo/be\u{7}ll.md");
        reject("kigo/nul\u{0}byte.md");
        reject("kigo/new\nline.md");
        reject("kigo/carriage\rreturn.md");
        reject("kigo/\u{85}next-line.md"); // C1 controls count too
    }

    #[test]
    fn refuses_dot_and_empty_segments() {
        // `Path::components` normalises all four of these away, so they are only
        // caught by reading the raw text — and kigo-io.ts refuses them, which is
        // the reason to bother.
        reject("./index.json");
        reject("kigo/./2026-02-11-x.md");
        reject("kigo//2026-02-11-x.md");
        reject("kigo/");
    }

    #[test]
    fn accepts_the_paths_the_store_actually_writes() {
        let root = fake_root();
        assert_eq!(accept("index.json"), root.join("index.json"));
        assert_eq!(
            accept("kigo/2026-02-11-kitchen-phone.md"),
            root.join("kigo").join("2026-02-11-kitchen-phone.md")
        );
        // slug() keeps letters in any script, so a Japanese stem is a
        // legitimate filename and must not be mistaken for something exotic
        accept("kigo/2026-02-11-食卓.md");
        // and the half-written temp file kigo_write_atomic drops beside it
        accept("kigo/.2026-02-11-kitchen-phone.md.tmp-1234-0");
    }

    #[test]
    fn nothing_it_accepts_lands_outside_the_root() {
        let root = fake_root();
        for rel in [
            "index.json",
            "kigo/2026-02-11-kitchen-phone.md",
            "kigo/2026-02-11-食卓.md",
            "kigo/.2026-02-11-kitchen-phone.md.tmp-1234-0",
        ] {
            let full = resolve_in(&root, rel).expect(rel);
            assert!(full.starts_with(&root), "{rel} resolved to {}", full.display());
        }
    }

    #[test]
    fn resolves_inside_a_root_that_really_exists() {
        // The one test with a filesystem under it, so the canonical-form
        // comparison is exercised rather than skipped for want of a directory.
        // It is in the OS temp directory and is nowhere near either store.
        let root = std::env::temp_dir().join(format!(
            "saijiki-resolve-test-{}-{}",
            std::process::id(),
            TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(root.join("kigo")).expect("could not make a temp root");

        assert_eq!(
            resolve_in(&root, "kigo/2026-02-11-kitchen-phone.md").expect("legitimate path"),
            root.join("kigo").join("2026-02-11-kitchen-phone.md")
        );
        assert!(resolve_in(&root, "kigo/../../escape.md").is_err());
        assert!(resolve_in(&root, "..").is_err());

        let _ = fs::remove_dir_all(&root);
    }
}
