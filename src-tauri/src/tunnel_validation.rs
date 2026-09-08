use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum TunnelValidation {
    Unknown,
    Pending,
    Healthy,
    Suspect,
    Failed,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct TunnelProbe {
    pub interface_up: bool,
    pub traffic_seen: bool,
    pub latency_ms: Option<u32>,
}

impl TunnelProbe {
    pub fn validate(&self) -> TunnelValidation {
        if !self.interface_up {
            return TunnelValidation::Failed;
        }

        if !self.traffic_seen {
            return TunnelValidation::Suspect;
        }

        if self.latency_ms.unwrap_or(0) > 1500 {
            return TunnelValidation::Suspect;
        }

        TunnelValidation::Healthy
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_down_interface() {
        let probe = TunnelProbe::default();
        assert_eq!(probe.validate(), TunnelValidation::Failed);
    }
}
