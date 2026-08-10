#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// IPC benchmark: echo an SVG-sized string back to the webview.
#[tauri::command]
fn bench_echo(payload: String) -> String {
    payload
}

/// Forward webview console/errors to stderr (headless diagnostics).
#[tauri::command]
fn js_log(msg: String) {
    eprintln!("[js] {msg}");
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

/// Native open dialog: returns (path, contents) or None when cancelled.
#[tauri::command]
async fn open_score() -> Result<Option<(String, String)>, String> {
    let Some(file) = rfd::AsyncFileDialog::new()
        .add_filter("MEI scores", &["mei", "xml"])
        .set_title("Open score")
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    let path = file.path().to_path_buf();
    let contents = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(Some((path.to_string_lossy().into_owned(), contents)))
}

/// Silent save to a known path (ctrl+s on an already-saved score).
#[tauri::command]
async fn save_score(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Save-as dialog: returns the chosen path, or None when cancelled.
#[tauri::command]
async fn save_score_as(contents: String, suggested: String) -> Result<Option<String>, String> {
    let Some(file) = rfd::AsyncFileDialog::new()
        .add_filter("MEI scores", &["mei"])
        .set_file_name(&suggested)
        .set_title("Save score")
        .save_file()
        .await
    else {
        return Ok(None);
    };
    let path = file.path().to_path_buf();
    std::fs::write(&path, contents).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Native MIDI: WebKitGTK has no Web MIDI API, so the shell bridges it —
/// every input port is connected and note on/off events stream to the
/// webview as Tauri events ("midi-note"), with the device list on
/// "midi-devices". A 2s poll handles hot-plug (midir has no callbacks).
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
                Some(probe.ports().iter().filter_map(|p| probe.port_name(p).ok()).collect())
            })()
            .unwrap_or_default();
            if names != last_names {
                connections.clear(); // drop = disconnect
                if let Ok(probe) = midir::MidiInput::new("battuta-probe") {
                    for port in probe.ports() {
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
    l.ends_with(".mei") || l.ends_with(".xml")
}

#[tauri::command]
fn initial_score(state: tauri::State<InitialFile>) -> Option<(String, String)> {
    let path = state.0.lock().ok()?.clone()?;
    let contents = std::fs::read_to_string(&path).ok()?;
    Some((path, contents))
}

fn main() {
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
    tauri::Builder::default()
        .manage(InitialFile(std::sync::Mutex::new(initial)))
        .setup(|app| {
            use tauri::Manager;
            spawn_midi(app.app_handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![bench_echo, bench_report, js_log, open_score, save_score, save_score_as, initial_score])
        .on_page_load(|webview, _| {
            eprintln!("[shell] page loaded: {}", webview.url().map(|u| u.to_string()).unwrap_or_default());
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
                   if (inv) inv('js_log', { msg: 'probe: __TAURI__=' + (window.__TAURI__ ? 'present' : 'MISSING') + ' tiles=' + document.querySelectorAll('.tile').length }); \
                 }, 3000);",
            );
            // probe3: mp3 decode — the page-view player's samples depend on
            // WebKitGTK's gstreamer plugins, which vary per system.
            let _ = webview.eval(
                "setTimeout(() => { \
                   const inv = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke; \
                   if (!inv || !window.__SAMPLE_URL__) return; \
                   fetch(window.__SAMPLE_URL__) \
                     .then((r) => r.arrayBuffer()) \
                     .then((b) => new AudioContext().decodeAudioData(b)) \
                     .then((a) => inv('js_log', { msg: 'probe3: mp3 decode ok (' + a.length + ' frames)' })) \
                     .catch((e) => inv('js_log', { msg: 'probe3: mp3 decode FAILED: ' + e })); \
                 }, 5000);",
            );
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
