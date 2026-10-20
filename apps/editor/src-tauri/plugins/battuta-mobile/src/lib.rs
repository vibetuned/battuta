//! battuta's native tablet services (phase 10, M1): what neither the
//! WebView nor Tauri's own plugins give a tablet.
//!
//! - **The share sheet** — a file handed to AirDrop, Mail, another app.
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
//! The page never calls this plugin: the shell does, from the workspace
//! and share commands it already answers (`lib.rs`), so the page's API
//! does not change with the platform.
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tauri::{
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
#[derive(Deserialize)]
struct Nothing {}

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
