#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// The desktop launcher; the shell itself is the library (lib.rs), which
// the mobile projects load too.
fn main() {
    battuta_lib::run()
}
