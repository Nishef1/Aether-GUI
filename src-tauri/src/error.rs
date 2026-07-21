use thiserror::Error;

#[derive(Debug, Error)]
pub enum AetherError {
    #[error("Aether is already running")]
    AlreadyRunning,
    #[error("Aether binary not found at {0}")]
    BinaryMissing(String),
    #[error("failed to launch Aether: {0}")]
    SpawnFailed(String),
    #[error("port {0} is already in use by another process")]
    PortInUse(u16),
    #[error("no active connection")]
    NotConnected,
    #[error("core manager error: {0}")]
    CoreManager(String),
    #[error("core update failed: {0}")]
    CoreUpdateFailed(String),
    #[error("administrator privileges are required for system-wide TUN mode")]
    ElevationRequired,
    #[error("sing-box binary not found at {0}")]
    SingboxBinaryMissing(String),
    #[error("sing-box is already running")]
    SingboxAlreadyRunning,
    #[error("failed to prepare sing-box configuration: {0}")]
    SingboxConfigFailed(String),
    #[error("TUN health check failed: {0}")]
    TunHealthFailed(String),
    #[error("internal error: {0}")]
    Internal(String),
}

impl serde::Serialize for AetherError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
