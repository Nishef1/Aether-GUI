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
    pub successes: u32,
}

impl PathHealthSnapshot {
    pub fn mark_success(&mut self, latency_ms: u64, now_ms: u64) {
        self.health = PathHealth::Healthy;
        self.latency_ms = Some(latency_ms);
        self.last_success_ms = Some(now_ms);
        self.failures = 0;
        self.successes = self.successes.saturating_add(1);
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

    pub fn score(&self) -> u16 {
        let base = match self.health {
            PathHealth::Healthy => 100,
            PathHealth::Suspect => 45,
            PathHealth::Failed => 0,
            PathHealth::Unknown => 25,
        };

        let latency_penalty = self
            .latency_ms
            .map(|latency| (latency / 10).min(35) as u16)
            .unwrap_or(20);

        let failure_penalty = self.failures.min(25) as u16;

        base.saturating_sub(latency_penalty)
            .saturating_sub(failure_penalty)
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

    #[test]
    fn failed_paths_score_lower_than_healthy_paths() {
        let mut healthy = PathHealthSnapshot::default();
        healthy.mark_success(40, 1000);

        let mut failed = PathHealthSnapshot::default();
        failed.mark_failed();

        assert!(healthy.score() > failed.score());
    }
}
