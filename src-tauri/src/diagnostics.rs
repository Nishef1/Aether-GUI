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

fn redact_sensitive(message: &str) -> String {
    let lower = message.to_ascii_lowercase();
    // Aether should not normally print secrets, but diagnostics survive app
    // restarts and may be shared in bug reports. Fail closed if an upstream
    // release ever logs obvious credential-bearing fields.
    const SENSITIVE_MARKERS: &[&str] = &[
        "private_key",
        "private key",
        "access_token",
        "access token",
        "authorization:",
        "authorization=",
        "bearer ",
        "token=",
        "token:",
        "secret=",
        "secret:",
        "password=",
        "password:",
    ];
    if SENSITIVE_MARKERS.iter().any(|marker| lower.contains(marker)) {
        "[redacted sensitive log line]".into()
    } else {
        message.to_string()
    }
}

pub fn record(component: &str, level: &str, message: impl AsRef<str>) {
    let Some(diag) = DIAGNOSTICS.get() else {
        return;
    };
    let message = redact_sensitive(message.as_ref());
    let entry = serde_json::json!({
        "timestamp_ms": now_millis(),
        "component": component,
        "level": level,
        "message": message,
    });
    if let Ok(mut file) = diag.file.lock() {
        let _ = writeln!(file, "{entry}");
        // Flush each entry deliberately: these logs are primarily for crashes
        // and tunnel failures, where losing the final buffered lines is worse
        // than the tiny write overhead of a desktop control-plane process.
        let _ = file.flush();
    }
}

pub fn record_status(status: &crate::state::ConnectionState) {
    match serde_json::to_string(status) {
        Ok(value) => record("state", "info", value),
        Err(e) => record("state", "warn", format!("failed to serialize state: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_obvious_credentials() {
        assert_eq!(
            redact_sensitive("Authorization: Bearer abc123"),
            "[redacted sensitive log line]"
        );
        assert_eq!(redact_sensitive("private_key = xyz"), "[redacted sensitive log line]");
        assert_eq!(redact_sensitive("connected to gateway"), "connected to gateway");
    }
}
