const COMMANDS: &[&str] = &[
    "prepare",
    "start",
    "stop",
    "status",
    "traffic",
    "telemetry",
    "logs",
    "diagnostics",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
