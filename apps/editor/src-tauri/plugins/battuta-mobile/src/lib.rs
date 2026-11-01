//! battuta's native tablet services (phase 10, M1): what neither the
//! WebView nor Tauri's own plugins give a tablet.
//!
//! - **The share sheet** — a file handed to AirDrop, Mail, another app.
//! - **Bluetooth MIDI pairing** (M3) — Apple's own Bluetooth MIDI view on
//!   iPadOS; on Android a scan for the MIDI service, a list, and the
//!   connection held open. A paired instrument is then an ordinary MIDI
//!   device of the system: the shell's CoreMIDI bridge hears it on the iPad,
//!   the WebView's Web MIDI on Android. (After midi-stroke's working
//!   version, Vibetuned's other app.)
//! - **Folders the user picks.** On iPadOS a picked folder is a real path
//!   behind a security scope: the plugin starts the scope and keeps a
//!   bookmark, so the folder reopens next launch (`open_folder`). On
//!   Android a picked folder is a document tree with no path at all: the
//!   shell gives it one — the tree's URI, then the names down to the
//!   document, `/`-separated (`content://…/tree/<id>/scores/aria.mei`) —
//!   so the page's path logic (parent, base name, rename) works on it
//!   unchanged, and this plugin lists, reads, writes, creates and renames
//!   by such paths, walking the tree name by name.
//!
//! - **The stylus** (1.3.0, phase 11) — the Apple Pencil and the S Pen,
//!   captured natively while the page asks for it (`stylus_capture`); and
//!   **granita** (1.3.5, M2), battuta's glyph classifier, read on a symbol's
//!   strokes (`stylus_recognize`) — the model's files live in this plugin,
//!   copied from a granita release by `scripts/copy-granita.sh`.
//!
//! The page never calls this plugin: the shell does, from the workspace,
//! share and stylus commands it already answers (`lib.rs`), so the page's
//! API does not change with the platform.
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    plugin::{Builder, PluginApi, PluginHandle, TauriPlugin},
    AppHandle, Manager, Runtime,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_battuta_mobile);

/// The native side, reachable from the shell's commands.
pub struct BattutaMobile<R: Runtime>(PluginHandle<R>);

/// Access through the app handle: `app.battuta_mobile()`.
pub trait BattutaMobileExt<R: Runtime> {
    fn battuta_mobile(&self) -> &BattutaMobile<R>;
}

impl<R: Runtime, T: Manager<R>> BattutaMobileExt<R> for T {
    fn battuta_mobile(&self) -> &BattutaMobile<R> {
        self.state::<BattutaMobile<R>>().inner()
    }
}

/// Where a symbol sits, in staff spaces (`ctx.stylus.recognize`'s context; granita's `SymbolContext`).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolContext {
    pub y_staff: f64,
    pub x_measure: f64,
    pub barline: f64,
    pub note_dx: Option<f64>,
    pub note_dy: Option<f64>,
    pub width: f64,
    pub height: f64,
}

/// One of granita's answers: a class of its sidecar and its confidence, 0–1.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Recognition {
    pub label: String,
    pub confidence: f64,
}

/// One entry of a listed folder (Android document trees).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub mtime: Option<i64>,
}

#[derive(Deserialize)]
struct PathOut {
    path: Option<String>,
}
#[derive(Deserialize)]
struct Entries {
    entries: Vec<Entry>,
}
#[derive(Deserialize)]
struct DataOut {
    data: String,
}
#[derive(Deserialize)]
struct MtimeOut {
    mtime: Option<i64>,
}
#[derive(Deserialize)]
struct SharedOut {
    completed: bool,
}
/// The answer of a command that returns nothing: a bare `resolve()` sends
/// `null` on both platforms, `resolve([:])` an empty object — either will do.
type Nothing = serde::de::IgnoredAny;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

impl<R: Runtime> BattutaMobile<R> {
    fn call<T: DeserializeOwned>(&self, method: &str, args: impl Serialize) -> Result<T, String> {
        self.0.run_mobile_plugin(method, args).map_err(err)
    }

    /// Hand a file to the share sheet; true when the user sent it somewhere.
    /// `data` is base64.
    pub fn share(&self, name: &str, data: &str) -> Result<bool, String> {
        #[derive(Serialize)]
        struct Args<'a> {
            name: &'a str,
            data: &'a str,
        }
        self.call::<SharedOut>("share", Args { name, data }).map(|o| o.completed)
    }

    /// Pair a Bluetooth MIDI instrument: the system's view on iPadOS, a scan
    /// and a list on Android (asking for "nearby devices" first). Returns
    /// when the view is shown; the instrument arrives as a MIDI device.
    pub fn bluetooth_midi(&self) -> Result<(), String> {
        self.call::<Nothing>("bluetoothMidi", ()).map(|_| ())
    }

    /// The stylus (1.3.0, phase 11): capture on or off. While on, every
    /// Apple Pencil or S Pen stroke that begins inside the score's area
    /// (`stylus_area`) is battuta's — the page never sees it; elsewhere the
    /// pen taps like a finger, and fingers still scroll, zoom and tap — and its events (strokes batched
    /// per frame, a hold, hover, the Pencil's squeeze and double-tap, the S
    /// Pen's side button: `StylusCapture.swift` / `StylusCapture.kt` say what
    /// each carries) reach `events` as JSON objects, from the native side's
    /// thread. Each call hands the native side a new channel; the last one
    /// given is the one it sends to.
    pub fn stylus_capture<F: Fn(serde_json::Value) + Send + Sync + 'static>(&self, on: bool, events: F) -> Result<(), String> {
        #[derive(Serialize)]
        struct Args {
            on: bool,
            channel: Channel,
        }
        let channel = Channel::new(move |body| {
            if let InvokeResponseBody::Json(json) = body {
                if let Ok(event) = serde_json::from_str(&json) {
                    events(event);
                }
            }
            Ok(())
        });
        self.call::<Nothing>("stylusCapture", Args { on, channel }).map(|_| ())
    }

    /// Where the pen writes: the score's area as page rectangles `[x, y,
    /// width, height]` (CSS pixels — the WebView's points and dp). A stroke
    /// that begins outside them is the page's. None until the page says.
    pub fn stylus_area(&self, rects: Vec<[f64; 4]>) -> Result<(), String> {
        #[derive(Serialize)]
        struct Args {
            rects: Vec<[f64; 4]>,
        }
        self.call::<Nothing>("stylusArea", Args { rects }).map(|_| ())
    }

    /// granita on a symbol (1.3.5, phase 11 M2): its strokes in page px,
    /// the staff space in page px, and where it sits — the native side
    /// rasterises as granita does, builds the context vector and runs the
    /// model (Core ML on iOS, LiteRT on Android, the files in this plugin):
    /// the classes by confidence, best first. Errors are the shell's: no
    /// model in the bundle, an OS too old for it.
    pub fn stylus_recognize(&self, strokes: Vec<Vec<[f64; 2]>>, staff_space: f64, context: Option<SymbolContext>) -> Result<Vec<Recognition>, String> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Args {
            strokes: Vec<Vec<[f64; 2]>>,
            staff_space: f64,
            context: Option<SymbolContext>,
        }
        #[derive(Deserialize)]
        struct Answer {
            top: Vec<Recognition>,
        }
        self.call::<Answer>("stylusRecognize", Args { strokes, staff_space, context }).map(|a| a.top)
    }

    /// The system folder picker. iPadOS: a path, its scope started and a
    /// bookmark kept. Android: the tree's root document URI, its
    /// permission persisted. None when dismissed.
    pub fn pick_folder(&self) -> Result<Option<String>, String> {
        self.call::<PathOut>("pickFolder", ()).map(|o| o.path)
    }

    /// Reopen a folder picked in an earlier session: its current path (a
    /// bookmark can follow a moved folder), or None when access is gone.
    pub fn open_folder(&self, path: &str) -> Result<Option<String>, String> {
        #[derive(Serialize)]
        struct Args<'a> {
            path: &'a str,
        }
        self.call::<PathOut>("openFolder", Args { path }).map(|o| o.path)
    }

    // --- Android document trees, by tree path (see the module comment) ------

    pub fn list_dir(&self, path: &str) -> Result<Vec<Entry>, String> {
        #[derive(Serialize)]
        struct Args<'a> {
            path: &'a str,
        }
        self.call::<Entries>("listDir", Args { path }).map(|o| o.entries)
    }

    /// The document's contents: UTF-8 text, or base64 when `base64`.
    pub fn read_file(&self, path: &str, base64: bool) -> Result<String, String> {
        #[derive(Serialize)]
        struct Args<'a> {
            path: &'a str,
            base64: bool,
        }
        self.call::<DataOut>("readFile", Args { path, base64 }).map(|o| o.data)
    }

    /// Replace the document's contents with `text` (UTF-8).
    pub fn write_file(&self, path: &str, text: &str) -> Result<(), String> {
        #[derive(Serialize)]
        struct Args<'a> {
            path: &'a str,
            text: &'a str,
        }
        self.call::<Nothing>("writeFile", Args { path, text }).map(|_| ())
    }

    /// A new document named `name` in the folder `dir`, holding `text` —
    /// refused when the name is taken. Its path.
    pub fn create_file(&self, dir: &str, name: &str, text: &str) -> Result<String, String> {
        #[derive(Serialize)]
        struct Args<'a> {
            dir: &'a str,
            name: &'a str,
            text: &'a str,
        }
        self.call::<PathOut>("createFile", Args { dir, name, text })?.path.ok_or_else(|| "the document was not created".into())
    }

    /// A new, empty folder — refused when the name is taken. Its path.
    pub fn create_folder(&self, dir: &str, name: &str) -> Result<String, String> {
        #[derive(Serialize)]
        struct Args<'a> {
            dir: &'a str,
            name: &'a str,
        }
        self.call::<PathOut>("createFolder", Args { dir, name })?.path.ok_or_else(|| "the folder was not created".into())
    }

    /// Rename in place — refused when the name is taken. The new path.
    pub fn rename(&self, path: &str, name: &str) -> Result<String, String> {
        #[derive(Serialize)]
        struct Args<'a> {
            path: &'a str,
            name: &'a str,
        }
        self.call::<PathOut>("rename", Args { path, name })?.path.ok_or_else(|| "the document was not renamed".into())
    }

    /// Last modification, in milliseconds since the epoch.
    pub fn mtime(&self, path: &str) -> Result<Option<i64>, String> {
        #[derive(Serialize)]
        struct Args<'a> {
            path: &'a str,
        }
        self.call::<MtimeOut>("mtime", Args { path }).map(|o| o.mtime)
    }
}

/// The plugin. Mobile only: on desktop it is not built into the app.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("battuta-mobile")
        .setup(|app, api| {
            let handle = register(app, api)?;
            app.manage(BattutaMobile(handle));
            Ok(())
        })
        .build()
}

fn register<R: Runtime, C: DeserializeOwned>(_app: &AppHandle<R>, api: PluginApi<R, C>) -> Result<PluginHandle<R>, Box<dyn std::error::Error>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin("com.vibetuned.battuta.mobile", "BattutaMobilePlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_battuta_mobile)?;
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let handle: PluginHandle<R> = {
        let _ = api;
        return Err("battuta-mobile is a tablet plugin".into());
    };
    Ok(handle)
}
