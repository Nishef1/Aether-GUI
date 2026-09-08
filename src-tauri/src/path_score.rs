use serde::{Deserialize, Serialize};

use crate::path_health::{PathHealth, PathHealthSnapshot};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
pub struct PathScore {
    pub score: u8,
    pub confidence: u8,
}

pub fn calculate(snapshot: &PathHealthSnapshot) -> PathScore {
    let score = snapshot.score().min(100) as u8;
    let confidence = match snapshot.health {
        PathHealth::Unknown => 10,
        PathHealth::Healthy => {
            let observed = snapshot.successes.min(7) as u8;
            60u8.saturating_add(observed.saturating_mul(5)).min(95)
        }
        PathHealth::Suspect => {
            let penalty = snapshot.failures.min(6) as u8 * 4;
            40u8.saturating_sub(penalty)
        }
        PathHealth::Failed => 0,
    };

    PathScore { score, confidence }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_path_scores_zero() {
        let mut state = PathHealthSnapshot::default();
        state.mark_failed();
        assert_eq!(calculate(&state).score, 0);
    }

    #[test]
    fn repeated_success_builds_confidence_without_exceeding_cap() {
        let mut state = PathHealthSnapshot::default();
        for _ in 0..32 {
            state.mark_success(40, 1000);
        }
        assert_eq!(calculate(&state).confidence, 95);
    }
}
