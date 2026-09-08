use crate::path_cooldown::PathCooldown;
use crate::path_score::PathScore;

#[derive(Debug, Clone, Default)]
pub struct PathCandidate {
    pub id: String,
    pub score: PathScore,
    pub cooldown: PathCooldown,
}

pub fn select_best(candidates: &[PathCandidate], now_ms: u64) -> Option<&PathCandidate> {
    candidates
        .iter()
        .filter(|candidate| !candidate.cooldown.is_blocked(now_ms))
        .max_by_key(|candidate| {
            (candidate.score.confidence as u16) * 100 + candidate.score.score as u16
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_available_high_confidence_path() {
        let candidates = vec![PathCandidate::default()];
        assert!(select_best(&candidates, 0).is_some());
    }
}
