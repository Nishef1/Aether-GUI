use serde::Serialize;

pub const STATUS_EVENT: &str = "aether://status";
pub const LOG_EVENT: &str = "aether://log";
pub const TELEMETRY_EVENT: &str = "aether://telemetry";

#[derive(Serialize, Clone, Debug)]
pub struct LogEvent {
    pub line: String,
    /// Milliseconds since UNIX_EPOCH — avoids pulling in a date/time crate
    /// just to format a value the frontend can turn into a Date() itself.
    pub timestamp: u64,
}

pub fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
