use serde::{Deserialize, Serialize};

use crate::path_score::PathScore;

const MAX_ENTRIES: usize = 8;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentWinner {
    pub id: String,
    pub score: u8,
    pub confidence: u8,
    pub updated_ms: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RecentWinnerCache {
    entries: Vec<RecentWinner>,
}

impl RecentWinnerCache {
    pub fn record(&mut self, id: String, score: PathScore, now_ms: u64) {
        self.entries.retain(|item| item.id != id);
        self.entries.insert(
            0,
            RecentWinner {
                id,
                score: score.score,
                confidence: score.confidence,
                updated_ms: now_ms,
            },
        );

        if self.entries.len() > MAX_ENTRIES {
            self.entries.truncate(MAX_ENTRIES);
        }
    }

    pub fn best(&self) -> Option<&RecentWinner> {
        self.entries
            .iter()
            .max_by_key(|item| (item.score, item.confidence, item.updated_ms))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_stays_bounded() {
        let mut cache = RecentWinnerCache::default();
        for i in 0..16 {
            cache.record(
                format!("path-{i}"),
                PathScore { score: 90, confidence: 80 },
                i,
            );
        }
        assert_eq!(cache.entries.len(), MAX_ENTRIES);
    }
}
