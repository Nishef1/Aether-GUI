use crate::error::AetherError;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum RuntimeError {
    #[error("unknown tunnel engine: {0}")]
    UnknownEngine(String),
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

fn strip_ansi_control_sequences(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(character) = chars.next() {
        if character != '\u{1b}' || chars.peek() != Some(&'[') {
            output.push(character);
            continue;
        }

        // Consume the CSI introducer and skip through its final byte. sing-box
        // uses these sequences for terminal colors (for example ESC[31m), but
        // Tauri errors are rendered as plain UI text where the raw bytes are
        // both noisy and misleading.
        chars.next();
        for next in chars.by_ref() {
            if ('@'..='~').contains(&next) {
                break;
            }
        }
    }

    output
}

impl serde::Serialize for RuntimeError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let message = strip_ansi_control_sequences(&self.to_string());
        serializer.serialize_str(&message)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialized_runtime_errors_strip_terminal_color_sequences() {
        let error = RuntimeError::SystemTunnel(
            "\u{1b}[31mERROR\u{1b}[0m[0000] invalid configuration".into(),
        );
        assert_eq!(
            serde_json::to_string(&error).unwrap(),
            "\"system tunnel error: ERROR[0000] invalid configuration\""
        );
    }

    #[test]
    fn normal_error_text_is_preserved() {
        assert_eq!(
            strip_ansi_control_sequences("system tunnel failed"),
            "system tunnel failed"
        );
    }
}
