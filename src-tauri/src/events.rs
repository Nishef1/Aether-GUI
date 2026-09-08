use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};

pub const STATUS_EVENT: &str = "aether://status";
pub const LOG_EVENT: &str = "aether://log";
pub const TELEMETRY_EVENT: &str = "aether://telemetry";

const ACCESS_CODE_MARKER: &str = "[gui] Zero Trust access code required";
const BUDGET_MARKER: &str = "budget=";

static DIAGNOSTICS_ENABLED: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Clone, Debug)]
pub struct LogEvent {
    pub line: String,
    pub timestamp: u64,
}

pub fn set_diagnostics_enabled(enabled: bool) {
    DIAGNOSTICS_ENABLED.store(enabled, Ordering::Relaxed);
}

pub fn should_forward_log(line: &str) -> bool {
    DIAGNOSTICS_ENABLED.load(Ordering::Relaxed)
        || line.contains(ACCESS_CODE_MARKER)
        || line.contains(BUDGET_MARKER)
}

pub fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}
