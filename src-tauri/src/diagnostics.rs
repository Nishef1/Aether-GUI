use crate::events::now_millis;
use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const MAX_LOG_BYTES: usize = 2 * 1024 * 1024;
const FLUSH_INTERVAL_BYTES: usize = 16 * 1024;
const LOG_FILE: &str = "aether-gui.jsonl";
const LEGACY_ROTATED_LOG_FILE: &str = "aether-gui.jsonl.1";

struct DiagnosticsFile {
    file: BufWriter<File>,
    written: usize,
    unflushed: usize,
    capped: bool,
}

struct Diagnostics {
    path: PathBuf,
    file: Mutex<DiagnosticsFile>,
}

static DIAGNOSTICS: OnceLock<Diagnostics> = OnceLock::new();
static HOME_PATHS: OnceLock<Vec<String>> = OnceLock::new();

pub fn init(app_data_dir: &Path) -> std::io::Result<PathBuf> {
    let log_dir = app_data_dir.join("logs");
    std::fs::create_dir_all(&log_dir)?;
    let path = log_dir.join(LOG_FILE);

    // Old builds rotated a second log file. It is no longer part of the bounded
    // session-log contract, so remove it opportunistically instead of leaving
    // stale disk usage behind forever.
    let _ = std::fs::remove_file(log_dir.join(LEGACY_ROTATED_LOG_FILE));

    // Each launch starts a fresh session log. A hard byte cap limits total disk
    // writes, and buffered writes avoid flushing every individual runtime line.
    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&path)?;
    let _ = DIAGNOSTICS.set(Diagnostics {
        path: path.clone(),
        file: Mutex::new(DiagnosticsFile {
            file: BufWriter::with_capacity(FLUSH_INTERVAL_BYTES, file),
            written: 0,
            unflushed: 0,
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

fn home_paths() -> &'static [String] {
    HOME_PATHS.get_or_init(|| {
        let Some(home) = std::env::var("USERPROFILE")
            .ok()
            .filter(|value| !value.is_empty())
            .or_else(|| std::env::var("HOME").ok().filter(|value| !value.is_empty()))
        else {
            return Vec::new();
        };

        let alternate = if home.contains('\\') {
            home.replace('\\', "/")
        } else {
            home.replace('/', "\\")
        };
        if alternate == home {
            vec![home]
        } else {
            vec![home, alternate]
        }
    })
}

fn redact_home_path(message: &str) -> String {
    home_paths()
        .iter()
        .fold(message.to_string(), |value, home| value.replace(home, "~"))
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

fn effective_level<'a>(component: &str, level: &'a str, message: &str) -> &'a str {
    if component != "aether" || level != "info" {
        return level;
    }

    // PTY output reaches this writer through one shared channel, so callers used
    // to label every Aether line as `info`. Preserve the core's own severity in
    // structured diagnostics without changing the user-visible log format.
    if message.contains(" ERROR ") || message.contains("] ERROR") {
        "error"
    } else if message.contains(" WARN ") || message.contains("] WARN") {
        "warn"
    } else {
        level
    }
}

pub fn record(component: &str, level: &str, message: impl AsRef<str>) {
    let Some(diagnostics) = DIAGNOSTICS.get() else {
        return;
    };
    let raw_message = message.as_ref();
    let level = effective_level(component, level, raw_message);
    let message = redact_sensitive(raw_message);
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
        if diagnostics_file.written.saturating_add(marker_required) <= MAX_LOG_BYTES
            && writeln!(diagnostics_file.file, "{marker}").is_ok()
        {
            diagnostics_file.written += marker_required;
            diagnostics_file.unflushed += marker_required;
        }
        let _ = diagnostics_file.file.flush();
        diagnostics_file.unflushed = 0;
        diagnostics_file.capped = true;
        return;
    }

    if writeln!(diagnostics_file.file, "{entry}").is_ok() {
        diagnostics_file.written += required;
        diagnostics_file.unflushed += required;

        // Errors are durability-critical. Warnings can be frequent in normal
        // network churn, so let the buffer coalesce them instead of forcing an
        // SSD flush for every transient connection reset.
        let should_flush = diagnostics_file.unflushed >= FLUSH_INTERVAL_BYTES || level == "error";
        if should_flush {
            let _ = diagnostics_file.file.flush();
            diagnostics_file.unflushed = 0;
        }
    }
}

pub fn flush() {
    let Some(diagnostics) = DIAGNOSTICS.get() else {
        return;
    };
    let Ok(mut diagnostics_file) = diagnostics.file.lock() else {
        return;
    };
    if diagnostics_file.unflushed == 0 {
        return;
    }
    if diagnostics_file.file.flush().is_ok() {
        diagnostics_file.unflushed = 0;
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

    #[test]
    fn preserves_aether_warn_and_error_severity() {
        assert_eq!(
            effective_level(
                "aether",
                "info",
                "[2026-07-21T14:00:00Z WARN  aether] reconnecting"
            ),
            "warn"
        );
        assert_eq!(
            effective_level(
                "aether",
                "info",
                "[2026-07-21T14:00:00Z ERROR aether] failed"
            ),
            "error"
        );
        assert_eq!(effective_level("aether", "info", "connected"), "info");
        assert_eq!(effective_level("sing-box", "info", " WARN "), "info");
    }
}
