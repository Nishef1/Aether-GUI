use crate::engine::EngineRuntime;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Shared connection state emitted by every transport and system-tunnel
/// adapter. The frontend lifecycle remains stable even when an implementation
/// changes underneath it.
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "state")]
pub enum ConnectionState {
    Idle,
    Launching,
    Connecting,
    Connected {
        socks_addr: String,
        connected_at_ms: u64,
    },
    StartingTunnel {
        tunnel: String,
        socks_addr: String,
        connected_at_ms: u64,
    },
    Tunneling {
        tunnel: String,
        socks_addr: String,
        connected_at_ms: u64,
    },
    Reconnecting {
        attempt: u32,
        max_attempts: u32,
    },
    Disconnecting,
    Error {
        message: String,
        phase: String,
    },
}

pub struct AppState {
    pub runtime: Arc<EngineRuntime>,
    shutdown_started: AtomicBool,
}

impl AppState {
    pub fn begin_shutdown(&self) -> bool {
        !self.shutdown_started.swap(true, Ordering::SeqCst)
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            runtime: Arc::new(EngineRuntime::default()),
            shutdown_started: AtomicBool::new(false),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shutdown_guard_only_allows_one_cleanup_pass() {
        let state = AppState::default();
        assert!(state.begin_shutdown());
        assert!(!state.begin_shutdown());
    }
}
