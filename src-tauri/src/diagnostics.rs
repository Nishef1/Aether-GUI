use crate::events::now_millis;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const MAX_LOG_BYTES: usize = 2 * 1024 * 1024;
const LOG_FILE: &str = "aether-gui.jsonl";

struct DiagnosticsFile {
    file: File,
    written: usize,
    capped: bool,
}

struct Diagnostics {
    path: PathBuf,
    file: Mutex<DiagnosticsFile>,
}

static DIAGNOSTICS: OnceLock<Diagnostics> = OnceLock::new();

pub fn init(app_data_dir: &Path) -> std::io::Result<PathBuf> {
    let log_dir = app_data_dir.join("logs");
    std::fs::create_dir_all(&log_dir)?;
    let path = log_dir.join(LOG_FILE);

    // Diagnostics are intentionally session-scoped: every process launch starts
    // with a fresh file. A hard in-session byte cap below prevents runaway core
    // output from continuously writing to disk.
    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&path)?;
    let _ = DIAGNOSTICS.set(Diagnostics {
        path: path.clone(),
        file: Mutex::new(DiagnosticsFile {
            file,
            written: 0,
            capped: false,
        }),
    });
    record("app", "info", "diagnostics initialized");
    Ok(path)
}

pub fn path() -> Option<PathBuf> {
    DIAGNOSTICS
        .get()
        .map(|diagnostics| diagnostics.path.clone())
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
    if SENSITIVE_MARKERS
        .iter()
        .any(|marker| lower.contains(marker))
    {
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
    })
    .to_string();
    let required = entry.len() + 1;

    let Ok(mut diagnostics_file) = diagnostics.file.lock() else {
        return;
    };
    if diagnostics_file.capped {
        return;
    }

    if diagnostics_file.written.saturating_add(required) > MAX_LOG_BYTES {
        let marker = serde_json::json!({
            "timestamp_ms": now_millis(),
            "component": "diagnostics",
            "level": "warn",
            "message": "session log size limit reached; further entries dropped",
        })
        .to_string();
        let marker_required = marker.len() + 1;
        if diagnostics_file
            .written
            .saturating_add(marker_required)
            <= MAX_LOG_BYTES
            && writeln!(diagnostics_file.file, "{marker}").is_ok()
        {
            diagnostics_file.written += marker_required;
            let _ = diagnostics_file.file.flush();
        }
        diagnostics_file.capped = true;
        return;
    }

    if writeln!(diagnostics_file.file, "{entry}").is_ok() {
        diagnostics_file.written += required;
        // Crash diagnostics favor durability over buffering a few final lines.
        let _ = diagnostics_file.file.flush();
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
        assert_eq!(
            redact_sensitive("connected to gateway"),
            "connected to gateway"
        );
    }
}
