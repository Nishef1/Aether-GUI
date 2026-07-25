const COMMANDS: &[&str] = &["prepare", "start", "stop", "status", "traffic", "diagnostics"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
