const COMMANDS: &[&str] = &[
    "prepare",
    "start",
    "stop",
    "status",
    "traffic",
    "telemetry",
    "logs",
    "setLogging",
    "submitAccessCode",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
