use crate::engine::EngineRuntime;
use serde::Serialize;
use std::sync::Arc;

/// Shared connection state emitted by every engine adapter. Keeping the state
/// machine engine-neutral lets Android and future sidecars integrate without
/// changing the frontend's lifecycle contract.
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "state")]
pub enum ConnectionState {
    Idle,
    Launching,
    Connecting,
    /// `connected_at_ms` is an absolute UNIX-epoch timestamp (ms) rather than
    /// a pre-computed elapsed duration, so the frontend can render a live-
    /// updating session timer without needing another event from the backend.
    Connected { socks_addr: String, connected_at_ms: u64 },
    Reconnecting { attempt: u32, max_attempts: u32 },
    Disconnecting,
    Error { message: String, phase: String },
}

pub struct AppState {
    pub runtime: Arc<EngineRuntime>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            runtime: Arc::new(EngineRuntime::default()),
        }
    }
}
