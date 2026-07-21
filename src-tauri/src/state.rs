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
