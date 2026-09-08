use serde::{Deserialize, Serialize};

use crate::path_health::{PathHealth, PathHealthSnapshot};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
pub struct PathScore {
    pub score: u8,
    pub confidence: u8,
}

pub fn calculate(snapshot: &PathHealthSnapshot) -> PathScore {
    let mut score = match snapshot.health {
        PathHealth::Healthy => 100i32,
        PathHealth::Suspect => 45,
        PathHealth::Unknown => 25,
        PathHealth::Failed => 0,
    };

    if let Some(latency) = snapshot.latency_ms {
        score -= ((latency / 50).min(35)) as i32;
    }

    score -= (snapshot.failures.min(10) * 4) as i32;
    score = score.clamp(0, 100);

    let confidence = match snapshot.health {
        PathHealth::Unknown => 10,
        PathHealth::Healthy => 80u8.saturating_sub(snapshot.failures as u8 * 5),
        PathHealth::Suspect => 40,
        PathHealth::Failed => 0,
    };

    PathScore {
        score: score as u8,
        confidence,
    }
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
}
