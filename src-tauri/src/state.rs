use crate::aether::AetherManager;
use crate::singbox::SingboxManager;
use serde::Serialize;
use std::sync::{Arc, Mutex};

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "state")]
pub enum ConnectionState {
    Idle,
    Launching,
    Connecting,
    /// Local Aether SOCKS proxy is healthy. When TUN is requested this is a
    /// short internal transition before the full system path is verified.
    Connected {
        socks_addr: String,
        connected_at_ms: u64,
    },
    /// Aether SOCKS is ready, but system routing has not yet been proven.
    /// This must never be presented to the user as a completed connection.
    StartingTunnel {
        socks_addr: String,
    },
    /// Full system traffic path through sing-box -> Aether SOCKS is verified.
    Tunneling {
        tun_addr: String,
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
    pub manager: Arc<Mutex<AetherManager>>,
    pub singbox: Arc<Mutex<SingboxManager>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            manager: Arc::new(Mutex::new(AetherManager::new())),
            singbox: Arc::new(Mutex::new(SingboxManager::new())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ConnectionState;

    #[test]
    fn tun_is_not_reported_as_connected_before_data_plane_verification() {
        let state = ConnectionState::StartingTunnel {
            socks_addr: "127.0.0.1:1819".into(),
        };
        let value = serde_json::to_value(state).unwrap();
        assert_eq!(value["state"], "StartingTunnel");
        assert!(value.get("connected_at_ms").is_none());
    }
}
