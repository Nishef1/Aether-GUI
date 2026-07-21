use crate::events::now_millis;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
const LOG_FILE: &str = "aether-gui.jsonl";
const OLD_LOG_FILE: &str = "aether-gui.jsonl.1";

struct Diagnostics {
    path: PathBuf,
    file: Mutex<File>,
}

static DIAGNOSTICS: OnceLock<Diagnostics> = OnceLock::new();

pub fn init(app_data_dir: &Path) -> std::io::Result<PathBuf> {
    let log_dir = app_data_dir.join("logs");
    fs::create_dir_all(&log_dir)?;
    let path = log_dir.join(LOG_FILE);

    if fs::metadata(&path).map(|m| m.len() >= MAX_LOG_BYTES).unwrap_or(false) {
        let old = log_dir.join(OLD_LOG_FILE);
        let _ = fs::remove_file(&old);
        let _ = fs::rename(&path, &old);
    }

    let file = OpenOptions::new().create(true).append(true).open(&path)?;
    let _ = DIAGNOSTICS.set(Diagnostics {
        path: path.clone(),
        file: Mutex::new(file),
    });
    record("app", "info", "diagnostics initialized");
    Ok(path)
}

pub fn path() -> Option<PathBuf> {
    DIAGNOSTICS.get().map(|d| d.path.clone())
}

pub fn record(component: &str, level: &str, message: impl AsRef<str>) {
    let Some(diag) = DIAGNOSTICS.get() else {
        return;
    };
    let entry = serde_json::json!({
        "timestamp_ms": now_millis(),
        "component": component,
        "level": level,
        "message": message.as_ref(),
    });
    if let Ok(mut file) = diag.file.lock() {
        let _ = writeln!(file, "{entry}");
        let _ = file.flush();
    }
}

pub fn record_status(status: &crate::state::ConnectionState) {
    match serde_json::to_string(status) {
        Ok(value) => record("state", "info", value),
        Err(e) => record("state", "warn", format!("failed to serialize state: {e}")),
    }
}
