use crate::error::AetherError;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum RuntimeError {
    #[error("unknown tunnel engine: {0}")]
    UnknownEngine(String),
    #[error("tunnel engine {0} is busy")]
    EngineBusy(String),
    #[error("invalid profile for {engine}: {message}")]
    InvalidProfile { engine: String, message: String },
    #[error("tunnel engine {engine} does not support interaction {interaction}")]
    UnsupportedInteraction { engine: String, interaction: String },
    #[error("unknown system tunnel: {0}")]
    UnknownSystemTunnel(String),
    #[error("system tunnel settings cannot change while a connection is active")]
    SystemTunnelBusy,
    #[error("system tunnel error: {0}")]
    SystemTunnel(String),
    #[error("{0}")]
    Engine(String),
    #[error("internal runtime error: {0}")]
    Internal(String),
}

impl From<AetherError> for RuntimeError {
    fn from(value: AetherError) -> Self {
        Self::Engine(value.to_string())
    }
}

impl serde::Serialize for RuntimeError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
