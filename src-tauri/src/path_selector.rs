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
        .filter(|candidate| candidate.score.score > 0 && candidate.cooldown.is_available(now_ms))
        .max_by_key(|candidate| {
            (candidate.score.score as u16) * 101 + candidate.score.confidence as u16
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_available_high_score_path() {
        let candidates = vec![
            PathCandidate {
                id: "high-confidence-low-score".into(),
                score: PathScore {
                    score: 55,
                    confidence: 95,
                },
                cooldown: PathCooldown::default(),
            },
            PathCandidate {
                id: "healthy".into(),
                score: PathScore {
                    score: 90,
                    confidence: 70,
                },
                cooldown: PathCooldown::default(),
            },
        ];

        assert_eq!(select_best(&candidates, 0).map(|path| path.id.as_str()), Some("healthy"));
    }

    #[test]
    fn skips_paths_in_cooldown() {
        let mut cooldown = PathCooldown::default();
        cooldown.penalize(1_000);
        let candidates = vec![PathCandidate {
            id: "blocked".into(),
            score: PathScore {
                score: 100,
                confidence: 95,
            },
            cooldown,
        }];

        assert!(select_best(&candidates, 2_000).is_none());
    }
}
