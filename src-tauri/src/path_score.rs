use serde::{Deserialize, Serialize};

use crate::path_health::{PathHealth, PathHealthSnapshot};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
pub struct PathScore {
    pub score: u8,
    pub confidence: u8,
}

pub fn calculate(snapshot: &PathHealthSnapshot) -> PathScore {
    calculate_with_capacity(snapshot, None, None, false)
}

pub fn calculate_with_capacity(
    snapshot: &PathHealthSnapshot,
    download_kbps: Option<u64>,
    upload_kbps: Option<u64>,
    upload_limited: bool,
) -> PathScore {
    let mut score = snapshot.score().min(100) as u8;
    let mut confidence = match snapshot.health {
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

    if download_kbps.is_some() || upload_kbps.is_some() {
        confidence = confidence.saturating_add(5).min(100);
    }

    // A severe asymmetric upload result is useful evidence for paths that can
    // browse but fail on interactive or upstream-heavy traffic. Keep it a
    // quality penalty rather than a hard health failure because ordinary
    // consumer links may be intentionally asymmetric.
    if upload_limited {
        score = score.saturating_sub(18);
    }

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

    #[test]
    fn bounded_capacity_evidence_increases_confidence() {
        let mut state = PathHealthSnapshot::default();
        state.mark_success(40, 1000);
        let baseline = calculate(&state);
        let measured = calculate_with_capacity(&state, Some(2_000), Some(500), false);
        assert!(measured.confidence > baseline.confidence);
        assert_eq!(measured.score, baseline.score);
    }

    #[test]
    fn severe_upload_limitation_is_a_penalty_not_a_hard_failure() {
        let mut state = PathHealthSnapshot::default();
        state.mark_success(40, 1000);
        let baseline = calculate(&state);
        let limited = calculate_with_capacity(&state, Some(4_000), Some(80), true);
        assert!(limited.score < baseline.score);
        assert!(limited.score > 0);
    }
}
