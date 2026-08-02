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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![bench_echo, bench_report, js_log])
        .on_page_load(|webview, _| {
            eprintln!("[shell] page loaded: {}", webview.url().map(|u| u.to_string()).unwrap_or_default());
            let _ = webview.eval(
                "setTimeout(() => { \
                   const inv = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke; \
                   if (inv) inv('js_log', { msg: 'probe: __TAURI__=' + (window.__TAURI__ ? 'present' : 'MISSING') + ' tiles=' + document.querySelectorAll('.tile').length }); \
                 }, 3000);",
            );
        })
        .run(tauri::generate_context!())
        .expect("error while running battuta");
}
