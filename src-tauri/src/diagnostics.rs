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

    if fs::metadata(&path)
        .map(|metadata| metadata.len() >= MAX_LOG_BYTES)
        .unwrap_or(false)
    {
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
    DIAGNOSTICS.get().map(|diagnostics| diagnostics.path.clone())
}

fn redact_home_path(message: &str) -> String {
    let home = std::env::var("USERPROFILE")
        .ok()
        .filter(|value| !value.is_empty())
        .or_else(|| std::env::var("HOME").ok().filter(|value| !value.is_empty()));

    let Some(home) = home else {
        return message.to_string();
    };
    let mut redacted = message.replace(&home, "~");
    let alternate = if home.contains('\\') {
        home.replace('\\', "/")
    } else {
        home.replace('/', "\\")
    };
    if alternate != home {
        redacted = redacted.replace(&alternate, "~");
    }
    redacted
}

fn redact_sensitive(message: &str) -> String {
    let lower = message.to_ascii_lowercase();
    const SENSITIVE_MARKERS: &[&str] = &[
        "private_key",
        "private key",
        "privatekey",
        "access_token",
        "access token",
        "accesstoken",
        "authorization:",
        "authorization=",
        "bearer ",
        "api_key",
        "api key",
        "apikey",
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
        redact_home_path(message)
    }
}

pub fn record(component: &str, level: &str, message: impl AsRef<str>) {
    let Some(diagnostics) = DIAGNOSTICS.get() else {
        return;
    };
    let message = redact_sensitive(message.as_ref());
    let entry = serde_json::json!({
        "timestamp_ms": now_millis(),
        "component": component,
        "level": level,
        "message": message,
    });
    if let Ok(mut file) = diagnostics.file.lock() {
        let _ = writeln!(file, "{entry}");
        // Crash diagnostics favor durability over buffering a few final lines.
        let _ = file.flush();
    }
}

pub fn record_status(status: &crate::state::ConnectionState) {
    match serde_json::to_string(status) {
        Ok(value) => record("state", "info", value),
        Err(error) => record(
            "state",
            "warn",
            format!("failed to serialize state: {error}"),
        ),
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
        assert_eq!(
            redact_sensitive("private_key = xyz"),
            "[redacted sensitive log line]"
        );
        assert_eq!(
            redact_sensitive("apiKey=xyz"),
            "[redacted sensitive log line]"
        );
        assert_eq!(redact_sensitive("connected to gateway"), "connected to gateway");
    }
}
