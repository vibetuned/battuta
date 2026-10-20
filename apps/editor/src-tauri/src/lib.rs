//! The battuta shell — desktop (Windows, macOS, Linux) and mobile (iPadOS,
//! Android tablets) from one crate. `run()` is the entry both use: desktop
//! through `main.rs`, mobile through the generated Xcode / Gradle projects.
//! Desktop-only services — native dialogs (`rfd`), MIDI (`midir`), folder
//! watching (`notify`) — are `#[cfg(desktop)]`; mobile gets them through
//! the OS document picker and its own MIDI later (phase 10).

/// IPC benchmark: echo an SVG-sized string back to the webview.
#[tauri::command]
fn bench_echo(payload: String) -> String {
    payload
}

/// Forward webview console/errors to stderr (headless diagnostics). Debug
/// builds on iOS also append them to `shell.log` in the app's data folder:
/// a network-paired iPad relays no stderr to the Mac, and
/// `xcrun devicectl device copy from` fetches the file (the device smoke).
#[tauri::command]
fn js_log(_app: tauri::AppHandle, msg: String) {
    eprintln!("[js] {msg}");
    #[cfg(all(target_os = "ios", debug_assertions))]
    {
        use std::io::Write;
        use tauri::Manager;
        if let Ok(dir) = _app.path().app_data_dir() {
            let _ = std::fs::create_dir_all(&dir);
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("shell.log")) {
                let _ = writeln!(f, "[js] {msg}");
            }
        }
    }
}

/// IPC benchmark: persist results and exit (used by headless bench runs).
#[tauri::command]
fn bench_report(report: String) {
    let path =
        std::env::var("BATTUTA_BENCH_OUT").unwrap_or_else(|_| "/tmp/battuta-ipc-bench.json".into());
    if let Err(e) = std::fs::write(&path, &report) {
        eprintln!("bench_report: failed to write {path}: {e}");
    }
    if std::env::var("BATTUTA_BENCH_EXIT").as_deref() == Ok("1") {
        std::process::exit(0);
    }
}

/// Point a dialog at the last-used folder (the frontend remembers it in
/// its settings and passes it back) — only when it still exists.
#[cfg(desktop)]
fn starting_dir(dir: Option<String>) -> Option<std::path::PathBuf> {
    let d = dir.map(std::path::PathBuf::from).filter(|d| d.is_dir());
    eprintln!("[shell] dialog starting dir: {d:?}");
    d
}

/// Native open dialog: returns (path, contents) or None when cancelled.
/// Extensions the open dialog offers — MEI plus every Verovio-importable
/// format (kept in sync with formats.ts by the frontend's import table).

/// Minimal base64 (no external crate): .mxl is a zip, and Tauri's IPC
/// carries strings — the frontend decodes with atob.
fn to_base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

/// The open dialog. Its filter and the extensions that must arrive as bytes
/// come from the frontend's formats registry (a plugin's declared import
/// widens both before its code loads); MEI alone when nothing is passed.
#[cfg(desktop)]
#[tauri::command]
async fn open_score(dir: Option<String>, exts: Option<Vec<String>>, binary_exts: Option<Vec<String>>) -> Result<Option<(String, String)>, String> {
    let exts = exts.unwrap_or_else(|| vec!["mei".to_owned()]);
    let ext_refs: Vec<&str> = exts.iter().map(String::as_str).collect();
    let mut dialog = rfd::AsyncFileDialog::new()
        .add_filter("scores", &ext_refs)
        .set_title("Open score");
    if let Some(d) = starting_dir(dir) {
        dialog = dialog.set_directory(d);
    }
    let Some(file) = dialog.pick_file().await
    else {
        return Ok(None);
    };
    let path = file.path().to_path_buf();
    // A `binary` import (a zip such as .mxl) is base64'd: Tauri's IPC carries
    // strings, and the frontend decodes by the extension it detects.
    let binary = binary_exts.unwrap_or_default();
    let contents = if path.extension().is_some_and(|e| binary.iter().any(|b| e.eq_ignore_ascii_case(b))) {
        to_base64(&std::fs::read(&path).map_err(|e| e.to_string())?)
    } else {
        std::fs::read_to_string(&path).map_err(|e| e.to_string())?
    };
    Ok(Some((path.to_string_lossy().into_owned(), contents)))
}

/// Export save dialog: any format the frontend produces, as raw bytes.
#[cfg(desktop)]
#[tauri::command]
async fn export_file(bytes: Vec<u8>, suggested: String, dir: Option<String>) -> Result<Option<String>, String> {
    let ext = suggested.rsplit('.').next().unwrap_or("").to_owned();
    let mut dialog = rfd::AsyncFileDialog::new()
        .add_filter(ext.clone(), &[ext])
        .set_file_name(&suggested)
        .set_title("Export");
    if let Some(d) = starting_dir(dir) {
        dialog = dialog.set_directory(d);
    }
    let Some(file) = dialog.save_file().await
    else {
        return Ok(None);
    };
    let path = file.path().to_path_buf();
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Native OK/Cancel confirm. The webview's own window.confirm is a
/// SILENT NO-OP in wry (immediately returns false), so every
/// destructive-action guard (dirty-tab close, overwrite prompts, paste
/// warnings) routes through this dialog in the shell.
#[cfg(desktop)]
#[tauri::command]
async fn confirm_dialog(title: String, message: String) -> bool {
    rfd::AsyncMessageDialog::new()
        .set_level(rfd::MessageLevel::Warning)
        .set_title(&title)
        .set_description(&message)
        .set_buttons(rfd::MessageButtons::OkCancel)
        .show()
        .await
        == rfd::MessageDialogResult::Ok
}

// --- workspace (slice 9a): the folders the user opened, read-only and SCOPED ---
//
// The host's `ctx.workspace` facade calls these. Roots are the folders
// picked through `workspace_pick_folder` (or re-admitted with
// `workspace_open_folder` from a plugin's persisted setting); every list,
// read and watch is refused outside them. No fs plugin, no broad
// permission: the scope is exactly what the user pointed at.

#[derive(Default)]
struct Workspace {
    roots: std::sync::Mutex<Vec<std::path::PathBuf>>,
    #[cfg(desktop)]
    watchers: std::sync::Mutex<std::collections::HashMap<u32, notify::RecommendedWatcher>>,
    #[cfg(desktop)]
    next_watch: std::sync::atomic::AtomicU32,
}

/// The canonical path when it lies under a picked root; an error otherwise.
fn within_roots(ws: &Workspace, path: &str) -> Result<std::path::PathBuf, String> {
    let p = std::fs::canonicalize(path).map_err(|e| format!("{path}: {e}"))?;
    let roots = ws.roots.lock().map_err(|_| "workspace state poisoned".to_string())?;
    if roots.iter().any(|r| p.starts_with(r)) {
        Ok(p)
    } else {
        Err(format!("{path} is outside the opened folders"))
    }
}

fn admit_root(ws: &Workspace, path: &std::path::Path) -> Result<String, String> {
    let c = std::fs::canonicalize(path).map_err(|e| format!("{}: {e}", path.display()))?;
    if !c.is_dir() {
        return Err(format!("{} is not a folder", path.display()));
    }
    let mut roots = ws.roots.lock().map_err(|_| "workspace state poisoned".to_string())?;
    if !roots.iter().any(|r| r == &c) {
        roots.push(c.clone());
    }
    Ok(c.to_string_lossy().into_owned())
}

/// The native folder dialog; the picked folder becomes a root. With
/// BATTUTA_WORKSPACE_TEST_DIR set (the shell smoke), that folder is picked
/// without a dialog.
#[cfg(desktop)]
#[tauri::command]
async fn workspace_pick_folder(ws: tauri::State<'_, Workspace>, dir: Option<String>) -> Result<Option<String>, String> {
    if let Ok(t) = std::env::var("BATTUTA_WORKSPACE_TEST_DIR") {
        return admit_root(&ws, std::path::Path::new(&t)).map(Some);
    }
    let mut dialog = rfd::AsyncFileDialog::new().set_title("Open folder");
    if let Some(d) = starting_dir(dir) {
        dialog = dialog.set_directory(d);
    }
    let Some(folder) = dialog.pick_folder().await
    else {
        return Ok(None);
    };
    admit_root(&ws, folder.path()).map(Some)
}

/// Re-admit a folder from an earlier session (a plugin persists the path). False when it is gone.
#[tauri::command]
fn workspace_open_folder(ws: tauri::State<'_, Workspace>, path: String) -> bool {
    admit_root(&ws, std::path::Path::new(&path)).is_ok()
}

/// Rename a file or folder IN PLACE (same parent) under a picked root —
/// the workspace's first write (2026-10-11, the folder view's rename).
/// `new_name` is a name, never a path. Refused: an empty, `.`, `..` or
/// dot-led name (hidden entries are not listed, so the entry would vanish),
/// a separator or NUL in it, a picked root itself (its path is the scope),
/// anything outside the roots, and an existing target — except the entry
/// itself under another case, which is how a case-only rename looks on a
/// case-insensitive disk. Returns the new path (the old one when the name
/// did not change).
fn rename_within(roots: &[std::path::PathBuf], path: &str, new_name: &str) -> Result<std::path::PathBuf, String> {
    let name = valid_name(new_name)?;
    let src = std::fs::canonicalize(path).map_err(|e| format!("{path}: {e}"))?;
    if !roots.iter().any(|r| src.starts_with(r)) {
        return Err(format!("{path} is outside the opened folders"));
    }
    if roots.iter().any(|r| r == &src) {
        return Err("the opened folder itself cannot be renamed here".into());
    }
    let parent = src.parent().ok_or_else(|| format!("{path} has no parent folder"))?;
    let dst = parent.join(name);
    if src.file_name().map(|n| n == std::ffi::OsStr::new(name)).unwrap_or(false) {
        return Ok(src);
    }
    if dst.exists() {
        let same = std::fs::canonicalize(&dst).map(|d| d == src).unwrap_or(false);
        if !same {
            return Err(format!("\"{name}\" already exists in this folder"));
        }
    }
    std::fs::rename(&src, &dst).map_err(|e| format!("could not rename: {e}"))?;
    Ok(dst)
}

#[tauri::command]
fn workspace_rename(ws: tauri::State<'_, Workspace>, path: String, new_name: String) -> Result<String, String> {
    let roots = ws.roots.lock().map_err(|_| "workspace state poisoned".to_string())?.clone();
    rename_within(&roots, &path, &new_name).map(|p| p.to_string_lossy().into_owned())
}

/// A name a workspace write may give an entry, trimmed: not empty, `.` or
/// `..`, no separator or NUL (a name, never a path), not dot-led (hidden
/// entries are not listed, so it would vanish). Shared by rename and create.
fn valid_name(raw: &str) -> Result<&str, String> {
    let name = raw.trim();
    if name.is_empty() || name == "." || name == ".." {
        return Err("a name is required".into());
    }
    if name.contains('/') || name.contains('\\') || name.contains('\0') {
        return Err(format!("\"{name}\" is not a name: it contains a separator"));
    }
    if name.starts_with('.') {
        return Err(format!("\"{name}\" starts with a dot: it would be hidden from the list"));
    }
    Ok(name)
}

/// Create a folder (`contents` None) or a file with `contents` IN a folder
/// under a picked root — the root itself included. Create-only: an existing
/// name is refused, and the file is opened `create_new`, so a race with
/// another program cannot overwrite either (2026-10-11, the folder view's
/// new score and new folder). Returns the new path.
fn create_within(roots: &[std::path::PathBuf], dir: &str, raw_name: &str, contents: Option<&str>) -> Result<std::path::PathBuf, String> {
    let name = valid_name(raw_name)?;
    let d = std::fs::canonicalize(dir).map_err(|e| format!("{dir}: {e}"))?;
    if !roots.iter().any(|r| d.starts_with(r)) {
        return Err(format!("{dir} is outside the opened folders"));
    }
    if !d.is_dir() {
        return Err(format!("{dir} is not a folder"));
    }
    let dst = d.join(name);
    if dst.exists() {
        return Err(format!("\"{name}\" already exists in this folder"));
    }
    match contents {
        None => std::fs::create_dir(&dst).map_err(|e| format!("could not create the folder: {e}"))?,
        Some(text) => {
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(&dst).map_err(|e| format!("could not create the file: {e}"))?;
            f.write_all(text.as_bytes()).map_err(|e| format!("could not write the file: {e}"))?;
        }
    }
    Ok(dst)
}

#[tauri::command]
fn workspace_create_folder(ws: tauri::State<'_, Workspace>, path: String, name: String) -> Result<String, String> {
    let roots = ws.roots.lock().map_err(|_| "workspace state poisoned".to_string())?.clone();
    create_within(&roots, &path, &name, None).map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn workspace_create_file(ws: tauri::State<'_, Workspace>, path: String, name: String, contents: String) -> Result<String, String> {
    let roots = ws.roots.lock().map_err(|_| "workspace state poisoned".to_string())?.clone();
    create_within(&roots, &path, &name, Some(&contents)).map(|p| p.to_string_lossy().into_owned())
}

#[derive(serde::Serialize)]
struct DirEntryOut {
    name: String,
    path: String,
    kind: &'static str,
}

/// The entries of a folder under a root: folders first, then files, by name; hidden entries skipped.
#[tauri::command]
fn workspace_read_dir(ws: tauri::State<'_, Workspace>, path: String) -> Result<Vec<DirEntryOut>, String> {
    let p = within_roots(&ws, &path)?;
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&p).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let ft = entry.file_type().map_err(|e| e.to_string())?;
        let kind = if ft.is_dir() {
            "dir"
        } else if ft.is_file() {
            "file"
        } else {
            continue;
        };
        out.push(DirEntryOut { name, path: entry.path().to_string_lossy().into_owned(), kind });
    }
    out.sort_by(|a, b| (a.kind != "dir").cmp(&(b.kind != "dir")).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

/// A file under a root, as text — or base64 when its extension is one the
/// frontend's formats registry reads as bytes (the open dialog's rule).
#[tauri::command]
fn workspace_read_file(ws: tauri::State<'_, Workspace>, path: String, binary_exts: Option<Vec<String>>) -> Result<String, String> {
    let p = within_roots(&ws, &path)?;
    let binary = binary_exts.unwrap_or_default();
    if p.extension().is_some_and(|e| binary.iter().any(|b| e.eq_ignore_ascii_case(b))) {
        Ok(to_base64(&std::fs::read(&p).map_err(|e| e.to_string())?))
    } else {
        std::fs::read_to_string(&p).map_err(|e| e.to_string())
    }
}

/// Watch a folder under a root, recursively. Events reach the frontend as
/// `workspace-change` { id, path, kind }; the facade coalesces them.
#[cfg(desktop)]
#[tauri::command]
fn workspace_watch(app: tauri::AppHandle, ws: tauri::State<'_, Workspace>, path: String) -> Result<u32, String> {
    use notify::Watcher;
    use tauri::Emitter;
    let p = within_roots(&ws, &path)?;
    let id = ws.next_watch.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
    let mut watcher = notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
        let Ok(ev) = res else { return };
        let kind = match ev.kind {
            notify::EventKind::Create(_) => "created",
            notify::EventKind::Remove(_) => "removed",
            notify::EventKind::Modify(_) => "modified",
            _ => return,
        };
        for path in ev.paths {
            // Canonical, like every path this service hands out (roots and
            // entries are canonicalised), so a listener can compare the
            // event's path with one it got from `read_dir`: macOS reports
            // `/var/folders/…` for a root admitted as `/private/var/…`.
            let path = std::fs::canonicalize(&path).unwrap_or(path);
            let _ = app.emit("workspace-change", serde_json::json!({ "id": id, "path": path.to_string_lossy(), "kind": kind }));
        }
    })
    .map_err(|e| e.to_string())?;
    watcher.watch(&p, notify::RecursiveMode::Recursive).map_err(|e| e.to_string())?;
    ws.watchers.lock().map_err(|_| "workspace state poisoned".to_string())?.insert(id, watcher);
    Ok(id)
}

#[cfg(desktop)]
#[tauri::command]
fn workspace_unwatch(ws: tauri::State<'_, Workspace>, id: u32) {
    if let Ok(mut w) = ws.watchers.lock() {
        w.remove(&id); // dropping the watcher stops it
    }
}

/// Modification time (ms since epoch) of a file, for the external-change
/// guard: save compares this against the value recorded at open/save and
/// alerts before overwriting edits made by another program.
#[tauri::command]
fn file_mtime(path: String) -> Option<i64> {
    let m = std::fs::metadata(&path).ok()?.modified().ok()?;
    Some(m.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as i64)
}

/// Silent save to a known path (ctrl+s on an already-saved score).
#[tauri::command]
async fn save_score(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Save-as dialog: returns the chosen path, or None when cancelled.
#[cfg(desktop)]
#[tauri::command]
async fn save_score_as(contents: String, suggested: String, dir: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::AsyncFileDialog::new()
        .add_filter("MEI scores", &["mei"])
        .set_file_name(&suggested)
        .set_title("Save score");
    if let Some(d) = starting_dir(dir) {
        dialog = dialog.set_directory(d);
    }
    let Some(file) = dialog.save_file().await
    else {
        return Ok(None);
    };
    let path = file.path().to_path_buf();
    std::fs::write(&path, contents).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// MIDI OUTPUT bridge for playback-to-MIDI mode (the webview has no Web
/// MIDI here): the frontend opens every output port once, then streams
/// note events through midi_send. Ports are deduped by name — the same
/// driver quirk as inputs. Dropping a connection closes it.
#[cfg(desktop)]
struct MidiOut(std::sync::Mutex<Vec<midir::MidiOutputConnection>>);

#[cfg(desktop)]
#[tauri::command]
fn midi_open_outputs(state: tauri::State<MidiOut>) -> Vec<String> {
    let mut conns = state.0.lock().expect("midi-out lock");
    conns.clear(); // reconnect fresh; drop = close
    let mut names = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let Ok(probe) = midir::MidiOutput::new("battuta-out-probe") else {
        return names;
    };
    for port in probe.ports() {
        let Ok(name) = probe.port_name(&port) else { continue };
        if !seen.insert(name.clone()) {
            continue; // duplicate-named port: same device twice
        }
        let Ok(out) = midir::MidiOutput::new("battuta-out") else { continue };
        if let Ok(conn) = out.connect(&port, "battuta-play") {
            conns.push(conn);
            names.push(name);
        }
    }
    // ALSO publish a virtual SOURCE named "battuta": consumer apps that
    // LISTEN to sources instead of exposing a destination (midi-sink, and
    // anything that treats apps like keyboards) can only hear us this way.
    // WinMM has no virtual ports, so Windows sends to destinations only.
    #[cfg(not(target_os = "windows"))]
    {
        use midir::os::unix::VirtualOutput;
        if let Ok(out) = midir::MidiOutput::new("battuta-out") {
            if let Ok(conn) = out.create_virtual("battuta") {
                conns.push(conn);
                names.push("battuta (virtual source)".into());
            }
        }
    }
    eprintln!("[shell] midi outputs: {names:?}");
    names
}

/// Uncheck: drop the connections AND the published virtual source, so
/// "battuta" doesn't linger in other apps' device lists.
#[cfg(desktop)]
#[tauri::command]
fn midi_close_outputs(state: tauri::State<MidiOut>) {
    state.0.lock().expect("midi-out lock").clear();
}

#[cfg(desktop)]
#[tauri::command]
fn midi_send(state: tauri::State<MidiOut>, data: Vec<u8>) {
    let mut conns = state.0.lock().expect("midi-out lock");
    for c in conns.iter_mut() {
        let _ = c.send(&data);
    }
}

/// Native MIDI: WebKitGTK has no Web MIDI API, so the shell bridges it —
/// every input port is connected and note on/off events stream to the
/// webview as Tauri events ("midi-note"), with the device list on
/// "midi-devices". A 2s poll handles hot-plug (midir has no callbacks).
#[cfg(desktop)]
fn spawn_midi(app: tauri::AppHandle) {
    use tauri::Emitter;
    std::thread::spawn(move || {
        // Smoke-test path: fake a device and a short note without hardware.
        if std::env::var("BATTUTA_MIDI_TEST").as_deref() == Ok("1") {
            std::thread::sleep(std::time::Duration::from_millis(4000));
            let _ = app.emit("midi-devices", vec!["Test Piano (fake)".to_string()]);
            std::thread::sleep(std::time::Duration::from_millis(1000));
            let _ = app.emit("midi-note", (60u8, true));
            std::thread::sleep(std::time::Duration::from_millis(200));
            let _ = app.emit("midi-note", (60u8, false));
            return;
        }
        let mut connections: Vec<midir::MidiInputConnection<()>> = Vec::new();
        let mut last_names: Vec<String> = Vec::new();
        loop {
            let names = (|| -> Option<Vec<String>> {
                let mut probe = midir::MidiInput::new("battuta-probe").ok()?;
                probe.ignore(midir::Ignore::None);
                // Some drivers (seen on Windows) register the same device
                // as TWO ports; connecting both would deliver every note
                // twice — dedupe by name here and when connecting below.
                // Our OWN virtual playback source is excluded: connecting
                // to it would feed MIDI playback back into note entry.
                let mut seen = std::collections::HashSet::new();
                Some(
                    probe
                        .ports()
                        .iter()
                        .filter_map(|p| probe.port_name(p).ok())
                        .filter(|n| !n.contains("battuta"))
                        .filter(|n| seen.insert(n.clone()))
                        .collect(),
                )
            })()
            .unwrap_or_default();
            if names != last_names {
                connections.clear(); // drop = disconnect
                if let Ok(probe) = midir::MidiInput::new("battuta-probe") {
                    let mut connected = std::collections::HashSet::new();
                    for port in probe.ports() {
                        // duplicate-named port: same device, skip (see above);
                        // our own virtual source: NEVER (feedback loop).
                        let Ok(port_name) = probe.port_name(&port) else { continue };
                        if port_name.contains("battuta") || !connected.insert(port_name) {
                            continue;
                        }
                        let Ok(mut input) = midir::MidiInput::new("battuta") else { continue };
                        input.ignore(midir::Ignore::None);
                        let app2 = app.clone();
                        if let Ok(conn) = input.connect(
                            &port,
                            "battuta-in",
                            move |_ts, msg, _| {
                                if msg.len() >= 3 {
                                    let status = msg[0] & 0xF0;
                                    let (note, vel) = (msg[1], msg[2]);
                                    if status == 0x90 && vel > 0 {
                                        let _ = app2.emit("midi-note", (note, true));
                                    } else if status == 0x80 || (status == 0x90 && vel == 0) {
                                        let _ = app2.emit("midi-note", (note, false));
                                    }
                                }
                            },
                            (),
                        ) {
                            connections.push(conn);
                        }
                    }
                }
                eprintln!("[shell] midi devices: {names:?}");
                last_names = names;
            }
            // Re-emit every tick: the first scan fires before the webview
            // has subscribed, so a change-only emit is never seen (the
            // frontend dedupes, so steady state is cheap).
            let _ = app.emit("midi-devices", last_names.clone());
            // The poll interval. On macOS a plain sleep would freeze the
            // device list forever: CoreMIDI posts hot-plug notifications to
            // THIS thread's run loop, and enumeration only updates after
            // they are processed — so pump the run loop for the interval
            // (falling back to sleep in the slices where it has no sources
            // and returns immediately).
            #[cfg(target_os = "macos")]
            {
                use core_foundation::runloop::{kCFRunLoopDefaultMode, CFRunLoop, CFRunLoopRunResult};
                let deadline = std::time::Instant::now() + std::time::Duration::from_millis(2000);
                while std::time::Instant::now() < deadline {
                    let r = unsafe { CFRunLoop::run_in_mode(kCFRunLoopDefaultMode, std::time::Duration::from_millis(250), false) };
                    if matches!(r, CFRunLoopRunResult::Finished) {
                        std::thread::sleep(std::time::Duration::from_millis(250));
                    }
                }
            }
            #[cfg(not(target_os = "macos"))]
            std::thread::sleep(std::time::Duration::from_millis(2000));
        }
    });
}

/// The score path handed to us at launch — argv on Linux/Windows, the
/// `Opened` run-loop event on macOS (which never uses argv for file
/// associations). The frontend PULLS this once it has mounted — pushing
/// it as an event would race the subscriber, exactly like the MIDI
/// device list did.
struct InitialFile(std::sync::Mutex<Option<String>>);

fn is_score_path(p: &str) -> bool {
    let l = p.to_lowercase();
    // Text formats only: initial_score reads to string (.mxl is a zip,
    // and a double-clicked .mxl is rare enough to route via open).
    ["mei", "xml", "musicxml", "abc", "pae", "krn", "kern"].iter().any(|e| l.ends_with(&format!(".{e}")))
}

#[tauri::command]
fn initial_score(state: tauri::State<InitialFile>) -> Option<(String, String)> {
    let path = state.0.lock().ok()?.clone()?;
    let contents = std::fs::read_to_string(&path).ok()?;
    Some((path, contents))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // tauri::is_dev() tracks the tauri crate's own custom-protocol feature —
    // the signal that actually decides embedded-vs-devUrl. Our wrapper
    // feature is NOT set by `tauri build` (the CLI enables the tauri crate's
    // feature directly), so a #[cfg] on it would mislabel bundled builds.
    if tauri::is_dev() {
        eprintln!(
            "[shell] mode: DEV SERVER — this build loads http://localhost:5173.\n\
             [shell] start it with `npm run dev -w @battuta/editor`,\n\
             [shell] or run the self-contained build: `cargo app` (alias for\n\
             [shell] `cargo run --release --features custom-protocol`)."
        );
    } else {
        eprintln!("[shell] mode: embedded assets (self-contained build) v{}", env!("CARGO_PKG_VERSION"));
    }
    let initial = std::env::args().nth(1).filter(|a| is_score_path(a));
    let builder = tauri::Builder::default()
        .manage(InitialFile(std::sync::Mutex::new(initial)))
        .manage(Workspace::default());
    #[cfg(desktop)]
    let builder = builder.manage(MidiOut(std::sync::Mutex::new(Vec::new())));
    builder
        .setup(|app| {
            use tauri::Manager;
            // The window is built here, not in tauri.conf.json, for one
            // switch: BATTUTA_EPHEMERAL_STORAGE=1 gives the WebView an
            // in-memory data store (incognito), so localStorage — the
            // recovered session, settings, plugin state — IndexedDB and
            // caches vanish with the process and the user's own storage is
            // never opened. The shell smoke sets it on every launch: before,
            // each run left its test scores in the user's session, to be
            // erased by hand (2026-09-16).
            let ephemeral = std::env::var("BATTUTA_EPHEMERAL_STORAGE").as_deref() == Ok("1");
            if ephemeral {
                eprintln!("[shell] storage: ephemeral (BATTUTA_EPHEMERAL_STORAGE=1) — nothing this run stores survives it");
            }
            // What shell this is, set before the page's first script: the
            // frontend takes the browser's paths for what mobile lacks.
            let shell = format!("window.__BATTUTA_SHELL__ = {{ platform: {:?}, mobile: {} }};", std::env::consts::OS, cfg!(mobile));
            let builder = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
                .initialization_script(&shell)
                .incognito(ephemeral);
            // A desktop window's title and size. On a tablet the WebView
            // fills the screen it is given — sized 1280×860 there, it ran
            // past the iPad Air's 1180×820 and hid the context bar
            // (2026-10-20).
            #[cfg(desktop)]
            let builder = builder.title("battuta").inner_size(1280.0, 860.0);
            builder.build()?;
            #[cfg(desktop)]
            spawn_midi(app.app_handle().clone());
            Ok(())
        })
        .invoke_handler(handlers())
        .on_page_load(|webview, payload| {
            // Fired at Started and at Finished; the probes below must be
            // scheduled once — twice, the second copy of probe3 found the
            // view already switched and logged a FAILED line every run.
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                return;
            }
            // The payload's URL, never webview.url(): on Android this runs on
            // the UI thread, and url() waits on that same thread — wry gives
            // up after 10 s, then aborts the app when the answer arrives late.
            eprintln!("[shell] page loaded: {}", payload.url());
            // Headless shell self-test: exercise the save command end to end.
            if let Ok(test_file) = std::env::var("BATTUTA_SHELL_TEST_FILE") {
                let js = format!(
                    "setTimeout(() => {{                        const inv = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;                        if (!inv) return;                        const xml = window.__SESSION__ ? window.__SESSION__.saveDocument() : '<no session>';                        inv('save_score', {{ path: {path:?}, contents: xml }})                          .then(() => inv('js_log', {{ msg: 'selftest: saved ' + xml.length + ' bytes' }}))                          .catch((e) => inv('js_log', {{ msg: 'selftest FAILED: ' + e }}));                      }}, 4000);",
                    path = test_file
                );
                let _ = webview.eval(&js);
            }
            let _ = webview.eval(
                "setTimeout(() => { \
                   const inv = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke; \
                   if (inv) inv('js_log', { msg: 'probe: __TAURI__=' + (window.__TAURI__ ? 'present' : 'MISSING') + ' tiles=' + document.querySelectorAll('.tile').length + ' rendered=' + document.querySelectorAll('.tile svg').length + ' shell=' + JSON.stringify(window.__BATTUTA_SHELL__ || null) }); \
                 }, 3000);",
            );
            // probes 3–5 drive the REAL UI (page view + play, a folder pick, the
            // folder view). They run only under the shell smoke: a normal launch
            // must never switch views, sound a note or open a folder by itself
            // (2026-09-16 — the user saw exactly that).
            if std::env::var("BATTUTA_SHELL_TEST_FILE").is_ok() {
                // probe3: playback end to end — switch to page view (which wakes
                // the playback plugin: its lazy chunk, then Tone's, must resolve
                // over tauri://), press play, and wait for the first note to
                // light. The player loads the Salamander mp3s through
                // decodeAudioData before it starts, so a lit note also proves
                // WebKitGTK's gstreamer mp3 support on this system — the check
                // the old __SAMPLE_URL__ hook made, now through the real UI
                // (slice 7b moved the samples into a plugin, which may not set
                // globals). Without a user gesture the context stays suspended,
                // so nothing sounds; the schedule and the highlight run anyway.
                let _ = webview.eval(
                    "setTimeout(() => { \
                       const inv = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke; \
                       if (!inv) return; \
                       const byText = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t); \
                       const pv = byText('page view'); \
                       if (!pv) { inv('js_log', { msg: 'probe3: playback FAILED: no page view button (buttons: ' + [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).join(' | ') + '; tabs: ' + document.querySelectorAll('.tab').length + ')' }); return; } \
                       pv.click(); \
                       const t0 = Date.now(); \
                       const step = () => { \
                         const toggle = document.querySelector('[data-player-toggle]'); \
                         if (toggle && !toggle.dataset.probed && document.querySelector('.pages .page svg')) { toggle.dataset.probed = '1'; toggle.click(); } \
                         const lit = document.querySelectorAll('.pages g.playing').length; \
                         const tm = window.__PLAYBACK__ ? window.__PLAYBACK__.events.length : 0; \
                         if (lit > 0) { inv('js_log', { msg: 'probe3: playback ok (plugin + Tone chunks loaded over tauri://, piano decoded, ' + tm + ' timemap events, ' + lit + ' lit)' }); return; } \
                         const notice = document.querySelector('[data-notice]'); \
                         if (notice && notice.textContent.includes('playback failed')) { inv('js_log', { msg: 'probe3: playback FAILED: ' + notice.textContent.trim() }); return; } \
                         if (Date.now() - t0 > 9000) { inv('js_log', { msg: 'probe3: playback FAILED: timeout (toggle=' + Boolean(toggle) + ' timemap=' + tm + ')' }); return; } \
                         setTimeout(step, 250); \
                       }; \
                       step(); \
                     }, 4000);",
                );
            }
            if let Ok(test_dir) = std::env::var("BATTUTA_WORKSPACE_TEST_DIR") {
                // probe4: the workspace service end to end — with
                // BATTUTA_WORKSPACE_TEST_DIR set the pick returns that folder
                // without a dialog; list it, refuse a read outside the roots,
                // watch it, and report the first change the smoke script makes.
                let _ = webview.eval(
                    "setTimeout(() => { \
                       const inv = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke; \
                       const listen = window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.listen; \
                       if (!inv || !listen) return; \
                       inv('workspace_pick_folder', {}) \
                         .then((root) => { if (!root) throw new Error('no folder picked'); return inv('workspace_read_dir', { path: root }).then((entries) => ({ root, entries })); }) \
                         .then(({ root, entries }) => inv('workspace_read_dir', { path: '/' }).then( \
                             () => { throw new Error('a read outside the roots was allowed'); }, \
                             () => ({ root, entries }))) \
                         .then(({ root, entries }) => { \
                           let reported = false; \
                           listen('workspace-change', (e) => { \
                             if (reported) return; reported = true; \
                             inv('js_log', { msg: 'probe4: workspace ok (' + entries.length + ' entries, scoped, change ' + e.payload.kind + ' ' + String(e.payload.path).split('/').pop() + ')' }); \
                           }); \
                           return inv('workspace_watch', { path: root }); \
                         }) \
                         .then((id) => inv('js_log', { msg: 'probe4: watching #' + id })) \
                         .catch((e) => inv('js_log', { msg: 'probe4: workspace FAILED: ' + e })); \
                     }, 5000);",
                );
                // probe5: the folder view end to end, through its real UI — the
                // declared 📁 (matched by EITHER hook: the plugin may already be
                // active from a remembered folder), the panel, a pick that lands on
                // the TEST folder (the pick command returns it without a dialog),
                // a score opened by clicking ITS row — matched by the folder's
                // name in the row's title, because a folder remembered from an
                // earlier run lists a two.mei of its own — marked open through
                // ctx.documents, and the live external-change guard's notice once
                // the smoke script appends to the file. The guard is REPORTED,
                // not required ("guard yes" / "guard no (no notice within 6 s)").
                let folder_name = std::path::Path::new(&test_dir).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                let js5 = format!(
                    "setTimeout(() => {{ \
                       const inv = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke; \
                       if (!inv) return; \
                       const FOLDER = {folder:?}; \
                       const fail = (why) => inv('js_log', {{ msg: 'probe5: folder view FAILED: ' + why }}); \
                       const t0 = Date.now(); \
                       let picked = false, clicked = false, entries = 0, ready = 0; \
                       /* probe6: the rename's SHELL half, through the host's own service (the field, the pencil and F2 are \
                          verify-folder-view.mjs's, which has a real pointer): two.mei, open in the active tab, becomes \
                          renamed.mei on disk; the tab follows (its name, and the path it saves to, in ctx.documents) and \
                          the list follows through the watch, as it would for a rename made in another app. */ \
                       /* probe7: the creates' SHELL half, through the host's service (the buttons and the field are \
                          verify-folder-view.mjs's): a folder 'made' in the test folder, a score 'fresh.mei' in it — the \
                          active score's MEI, so it is a real one — opened through the host's open path as a tab, and the \
                          list following through the watch. */ \
                       /* probe8: the PDF reference in the SHELL — pdf.js, its worker and an OffscreenCanvas inside the \
                          webview over tauri:// — when the smoke copied an example into <test folder>/pdfref: the files are \
                          read through the workspace, handed to the panel's file input, and the probe waits for the pages \
                          and for scans above the tiles. The panel's own UI is verify-pdf-reference.mjs's. */ \
                       const pdfProbe = (root) => {{ \
                         const ws = window.__HOST__.workspace; \
                         const dir = root + '/pdfref'; \
                         ws.readDir(dir).then((entries) => Promise.all(entries.filter((e) => e.kind === 'file').map((e) => \
                           inv('workspace_read_file', {{ path: e.path, binaryExts: ['pdf'] }}).then((data) => {{ \
                             const pdf = /\\.pdf$/i.test(e.name); \
                             const bytes = pdf ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0)) : new TextEncoder().encode(data); \
                             return new File([bytes], e.name, {{ type: pdf ? 'application/pdf' : 'application/json' }}); \
                           }})))) \
                         .then((files) => {{ \
                           if (!files.length) {{ inv('js_log', {{ msg: 'probe8: pdf skipped (no example copied)' }}); return; }} \
                           const t = document.querySelector('[data-slot-command=\"battuta.pdf-reference.toggle\"], [data-pdf-toggle]'); \
                           if (!t) {{ inv('js_log', {{ msg: 'probe8: pdf FAILED: no 📄 in the header' }}); return; }} \
                           /* probe3 left the app in page view to play; the scans stand above the tiles of EDIT view */ \
                           const back = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'edit view'); \
                           if (back) back.click(); \
                           t.click(); \
                           const t0 = Date.now(); \
                           const feed = () => {{ \
                             const input = document.querySelector('[data-pdf-file]'); \
                             if (!input) {{ if (Date.now() - t0 > 5000) {{ inv('js_log', {{ msg: 'probe8: pdf FAILED: no panel' }}); return; }} setTimeout(feed, 100); return; }} \
                             const dt = new DataTransfer(); \
                             files.forEach((f) => dt.items.add(f)); \
                             input.files = dt.files; \
                             input.dispatchEvent(new Event('change', {{ bubbles: true }})); \
                             const t1 = Date.now(); \
                             const wait = () => {{ \
                               const ref = document.querySelector('[data-pdf-ref]'); \
                               const state = ref && ref.getAttribute('data-pdf-state'); \
                               const scans = document.querySelectorAll('[data-pdf-scan]').length; \
                               if (state === 'ready' && scans > 0) {{ inv('js_log', {{ msg: 'probe8: pdf ok (' + ref.getAttribute('data-pdf-pages') + ' pages, ' + ref.getAttribute('data-pdf-matched') + ' placed ' + ref.getAttribute('data-pdf-mode') + ', ' + scans + ' scans, ' + (Date.now() - t1) + ' ms)' }}); return; }} \
                               if (state === 'error') {{ inv('js_log', {{ msg: 'probe8: pdf FAILED: ' + ((document.querySelector('[data-pdf-status]') || {{}}).textContent || 'error') }}); return; }} \
                               if (Date.now() - t1 > 9000) {{ inv('js_log', {{ msg: 'probe8: pdf FAILED: timeout (state=' + state + ', scans=' + scans + ')' }}); return; }} \
                               setTimeout(wait, 200); \
                             }}; \
                             wait(); \
                           }}; \
                           feed(); \
                         }}) \
                         .catch((e) => inv('js_log', {{ msg: 'probe8: pdf FAILED: ' + e }})); \
                       }}; \
                       const create = (root) => {{ \
                         const ws = window.__HOST__.workspace; \
                         ws.createFolder(root, 'made') \
                           .then((dir) => ws.createFile(dir, 'fresh.mei', window.__SESSION__.saveDocument())) \
                           .then((file) => ws.openDocument(file).then(() => file)) \
                           .then((file) => {{ \
                             const t2 = Date.now(); \
                             const check = () => {{ \
                               const docs = window.__HOST__.documents.get(); \
                               const tab = document.querySelector('.tab.active'); \
                               const opened = docs.some((d) => (d.path || '').endsWith('fresh.mei')); \
                               const named = Boolean(tab && tab.textContent.indexOf('fresh') >= 0); \
                               const listed = [...document.querySelectorAll('[data-folder-entry]')].some((r) => r.dataset.folderEntry === 'made'); \
                               if (opened && named && listed) {{ inv('js_log', {{ msg: 'probe7: create ok (made/' + file.split(/[\\\\/]/).pop() + ', opened as a tab, list followed)' }}); pdfProbe(root); return; }} \
                               if (Date.now() - t2 > 5000) {{ inv('js_log', {{ msg: 'probe7: create FAILED (opened=' + opened + ' named=' + named + ' listed=' + listed + ')' }}); return; }} \
                               setTimeout(check, 200); \
                             }}; \
                             check(); \
                           }}) \
                           .catch((e) => inv('js_log', {{ msg: 'probe7: create FAILED: ' + e }})); \
                       }}; \
                       const rename = (path) => {{ \
                         const ws = window.__HOST__ && window.__HOST__.workspace; \
                         if (!ws) {{ inv('js_log', {{ msg: 'probe6: rename FAILED: no host' }}); return; }} \
                         ws.rename(path, 'renamed.mei').then((to) => {{ \
                           const t1 = Date.now(); \
                           const check = () => {{ \
                             const docs = window.__HOST__.documents.get(); \
                             const tab = document.querySelector('.tab.active'); \
                             const followed = docs.some((d) => (d.path || '').endsWith('renamed.mei')) && !docs.some((d) => (d.path || '').endsWith('two.mei')); \
                             const named = Boolean(tab && tab.textContent.indexOf('renamed') >= 0); \
                             const listed = [...document.querySelectorAll('[data-folder-entry]')].some((r) => r.dataset.folderEntry === 'renamed.mei'); \
                             if (followed && named && listed) {{ inv('js_log', {{ msg: 'probe6: rename ok (' + to.split(/[\\\\/]/).pop() + ', tab followed, list followed)' }}); create(to.replace(/[\\\\/][^\\\\/]*$/, '')); return; }} \
                             if (Date.now() - t1 > 5000) {{ inv('js_log', {{ msg: 'probe6: rename FAILED (followed=' + followed + ' named=' + named + ' listed=' + listed + ')' }}); return; }} \
                             setTimeout(check, 200); \
                           }}; \
                           check(); \
                         }}).catch((e) => inv('js_log', {{ msg: 'probe6: rename FAILED: ' + e }})); \
                       }}; \
                       const step = () => {{ \
                         const panel = document.querySelector('[data-folder-view]'); \
                         if (!panel) {{ \
                           const t = document.querySelector('[data-slot-command=\"battuta.folder-view.toggle\"], [data-folder-toggle]'); \
                           if (!t) {{ fail('no folder-view button in the header'); return; }} \
                           if (!t.dataset.probe) {{ t.dataset.probe = '1'; t.click(); }} \
                         }} \
                         if (panel && !picked) {{ const pick = panel.querySelector('[data-folder-pick]'); if (pick) {{ picked = true; pick.click(); }} }} \
                         const rows = [...document.querySelectorAll('[data-folder-entry]')].filter((r) => (r.title || '').indexOf('/' + FOLDER + '/') >= 0); \
                         if (rows.length) entries = rows.length; \
                         const two = rows.find((r) => r.dataset.folderEntry === 'two.mei'); \
                         if (two && !clicked) {{ clicked = true; two.click(); }} \
                         const marked = Boolean(two && two.hasAttribute('data-folder-open')); \
                         const notice = document.querySelector('[data-notice]'); \
                         const guard = Boolean(notice && notice.textContent.indexOf('changed on disk') >= 0); \
                         if (marked && !ready) ready = Date.now(); \
                         if (marked && (guard || Date.now() - ready > 8000)) {{ inv('js_log', {{ msg: 'probe5: folder view ok (' + entries + ' entries, opened two.mei, marked open, guard ' + (guard ? 'yes' : 'no (no notice within 8 s)') + ')' }}); rename(two.title); return; }} \
                         if (Date.now() - t0 > 14000) {{ fail('timeout (picked=' + picked + ' clicked=' + clicked + ' entries=' + entries + ' marked=' + marked + ')'); return; }} \
                         setTimeout(step, 250); \
                       }}; \
                       step(); \
                     }}, 7500);",
                    folder = folder_name
                );
                let _ = webview.eval(&js5);
            }
            let _ = webview.eval(
                "setTimeout(() => { \
                   const inv = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke; \
                   if (!inv) return; \
                   const midi = document.querySelector('[data-midi-indicator]'); \
                   const notice = document.querySelector('[data-notice]'); \
                   const tab = document.querySelector('.tab.active') || document.querySelector('.tab'); \
                   inv('js_log', { msg: 'probe2: midi=' + (midi ? midi.textContent.trim() : 'n/a') + ' tab=' + (tab ? tab.textContent.replace(/\\u00d7/g, '').trim() : 'n/a') + ' notice=' + (notice ? notice.textContent.trim() : '') }); \
                 }, 7000);",
            );
        })
        .build(tauri::generate_context!())
        .expect("error while building battuta")
        .run(|_app, _event| {
            // macOS delivers file-association opens as an Opened event, not
            // argv. At launch it fires while the webview is still loading,
            // so seeding the state here wins the race with the frontend's
            // initial_score pull. (Dropping a file onto an already-running
            // instance would additionally need a frontend listener.)
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &_event {
                use tauri::Manager;
                let path = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
                    .find(|p| is_score_path(p));
                if let Some(p) = path {
                    if let Ok(mut slot) = _app.state::<InitialFile>().0.lock() {
                        *slot = Some(p);
                    }
                }
            }
        });
}

/// The commands this platform answers. Mobile has no native dialogs, MIDI
/// or folder watching yet: the page is told what shell it runs in
/// (`window.__BATTUTA_SHELL__`, set before it loads) and does not call
/// the rest.
#[cfg(desktop)]
fn handlers() -> impl Fn(tauri::ipc::Invoke) -> bool {
    tauri::generate_handler![bench_echo, bench_report, js_log, open_score, save_score, save_score_as, export_file, file_mtime, confirm_dialog, midi_open_outputs, midi_close_outputs, midi_send, initial_score, workspace_pick_folder, workspace_open_folder, workspace_read_dir, workspace_read_file, workspace_rename, workspace_create_folder, workspace_create_file, workspace_watch, workspace_unwatch]
}
#[cfg(mobile)]
fn handlers() -> impl Fn(tauri::ipc::Invoke) -> bool {
    tauri::generate_handler![bench_echo, bench_report, js_log, save_score, file_mtime, initial_score, workspace_open_folder, workspace_read_dir, workspace_read_file, workspace_rename, workspace_create_folder, workspace_create_file]
}

#[cfg(test)]
mod tests {
    use super::{create_within, rename_within};
    use std::path::PathBuf;

    /// A fresh folder under the system temp dir, canonical (macOS puts /var behind /private/var).
    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("battuta-rename-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::canonicalize(&dir).unwrap()
    }

    #[test]
    fn renames_a_file_and_a_folder_in_place() {
        let root = scratch("ok");
        std::fs::write(root.join("one.mei"), "<mei/>").unwrap();
        std::fs::create_dir(root.join("bach")).unwrap();
        std::fs::write(root.join("bach").join("bwv1.mei"), "<mei/>").unwrap();
        let roots = vec![root.clone()];
        let to = rename_within(&roots, root.join("one.mei").to_str().unwrap(), "  first.mei ").unwrap();
        assert_eq!(to, root.join("first.mei"));
        assert!(to.exists() && !root.join("one.mei").exists());
        let to = rename_within(&roots, root.join("bach").to_str().unwrap(), "Bach").unwrap();
        assert!(to.join("bwv1.mei").exists());
        // the same name is a no-op, not an error
        assert_eq!(rename_within(&roots, to.to_str().unwrap(), "Bach").unwrap(), to);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn refuses_bad_names_existing_targets_roots_and_the_outside() {
        let root = scratch("refuse");
        let outside = scratch("outside");
        std::fs::write(root.join("a.mei"), "").unwrap();
        std::fs::write(root.join("b.mei"), "").unwrap();
        std::fs::write(outside.join("x.mei"), "").unwrap();
        let roots = vec![root.clone()];
        let a = root.join("a.mei");
        let a = a.to_str().unwrap();
        for bad in ["", "  ", ".", "..", "x/y.mei", "x\\y.mei", ".hidden.mei"] {
            assert!(rename_within(&roots, a, bad).is_err(), "{bad:?} should be refused");
        }
        assert!(rename_within(&roots, a, "b.mei").unwrap_err().contains("already exists"));
        assert!(rename_within(&roots, root.to_str().unwrap(), "elsewhere").unwrap_err().contains("opened folder itself"));
        assert!(rename_within(&roots, outside.join("x.mei").to_str().unwrap(), "y.mei").unwrap_err().contains("outside"));
        assert!(std::path::Path::new(a).exists() && root.join("b.mei").exists() && outside.join("x.mei").exists());
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&outside).unwrap();
    }

    #[test]
    fn creates_a_folder_and_a_file_in_the_root_or_below() {
        let root = scratch("create");
        let roots = vec![root.clone()];
        let made = create_within(&roots, root.to_str().unwrap(), " Bach ", None).unwrap();
        assert_eq!(made, root.join("Bach"));
        assert!(made.is_dir());
        let score = create_within(&roots, made.to_str().unwrap(), "fugue.mei", Some("<mei/>")).unwrap();
        assert_eq!(std::fs::read_to_string(&score).unwrap(), "<mei/>");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn create_never_overwrites_and_stays_inside() {
        let root = scratch("create-refuse");
        let outside = scratch("create-outside");
        std::fs::write(root.join("a.mei"), "keep").unwrap();
        let roots = vec![root.clone()];
        let r = root.to_str().unwrap();
        assert!(create_within(&roots, r, "a.mei", Some("new")).unwrap_err().contains("already exists"));
        assert_eq!(std::fs::read_to_string(root.join("a.mei")).unwrap(), "keep");
        assert!(create_within(&roots, r, "a.mei", None).unwrap_err().contains("already exists"));
        for bad in ["", "..", "x/y", ".hidden"] {
            assert!(create_within(&roots, r, bad, None).is_err(), "{bad:?} should be refused");
        }
        assert!(create_within(&roots, outside.to_str().unwrap(), "x.mei", Some("")).unwrap_err().contains("outside"));
        assert!(create_within(&roots, root.join("a.mei").to_str().unwrap(), "x.mei", Some("")).unwrap_err().contains("not a folder"));
        assert!(!outside.join("x.mei").exists());
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&outside).unwrap();
    }
}
