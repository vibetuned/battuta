// No commands of its own for the page: the shell's Rust calls the native
// side directly (lib.rs routes its workspace and share commands here).
const COMMANDS: &[&str] = &[];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
