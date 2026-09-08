use serde::{Deserialize, Serialize};

const DEFAULT_COOLDOWN_MS: u64 = 60_000;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
pub struct PathCooldown {
    pub blocked_until_ms: Option<u64>,
}

impl PathCooldown {
    pub fn is_available(&self, now_ms: u64) -> bool {
        self.blocked_until_ms.map(|t| now_ms >= t).unwrap_or(true)
    }

    pub fn penalize(&mut self, now_ms: u64) {
        self.blocked_until_ms = Some(now_ms.saturating_add(DEFAULT_COOLDOWN_MS));
    }

    pub fn clear(&mut self) {
        self.blocked_until_ms = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cooldown_blocks_until_expiry() {
        let mut cooldown = PathCooldown::default();
        cooldown.penalize(1000);
        assert!(!cooldown.is_available(2000));
        assert!(cooldown.is_available(70000));
    }
}
