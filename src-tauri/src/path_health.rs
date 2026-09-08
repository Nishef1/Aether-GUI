use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum PathHealth {
    #[default]
    Unknown,
    Healthy,
    Suspect,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PathHealthSnapshot {
    pub health: PathHealth,
    pub latency_ms: Option<u64>,
    pub last_success_ms: Option<u64>,
    pub failures: u32,
}

impl PathHealthSnapshot {
    pub fn mark_success(&mut self, latency_ms: u64, now_ms: u64) {
        self.health = PathHealth::Healthy;
        self.latency_ms = Some(latency_ms);
        self.last_success_ms = Some(now_ms);
        self.failures = 0;
    }

    pub fn mark_suspect(&mut self) {
        if self.health != PathHealth::Failed {
            self.health = PathHealth::Suspect;
        }
        self.latency_ms = None;
        self.failures = self.failures.saturating_add(1);
    }

    pub fn mark_failed(&mut self) {
        self.health = PathHealth::Failed;
        self.latency_ms = None;
        self.failures = self.failures.saturating_add(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn successful_probe_resets_failures() {
        let mut state = PathHealthSnapshot::default();
        state.failures = 3;
        state.mark_success(42, 1000);
        assert_eq!(state.health, PathHealth::Healthy);
        assert_eq!(state.failures, 0);
    }
}
