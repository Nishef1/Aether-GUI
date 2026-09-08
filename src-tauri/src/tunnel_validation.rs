use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum TunnelValidation {
    #[default]
    Unknown,
    Pending,
    Healthy,
    Suspect,
    Failed,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct TunnelProbe {
    pub required: bool,
    pub interface_up: bool,
    pub traffic_seen: bool,
    pub egress_ok: bool,
    pub latency_ms: Option<u64>,
}

impl TunnelProbe {
    pub fn validate(&self) -> TunnelValidation {
        if !self.required {
            return if self.egress_ok {
                TunnelValidation::Healthy
            } else {
                TunnelValidation::Pending
            };
        }

        // Starting a system tunnel and publishing its interface are separate
        // lifecycle steps. Missing interface counters are therefore pending,
        // not proof that the tunnel failed; the runtime supervisor owns hard
        // failure detection.
        if !self.interface_up {
            return TunnelValidation::Pending;
        }
        if !self.egress_ok {
            return TunnelValidation::Suspect;
        }
        if !self.traffic_seen {
            return TunnelValidation::Pending;
        }
        if self.latency_ms.unwrap_or(0) > 1_500 {
            return TunnelValidation::Suspect;
        }

        TunnelValidation::Healthy
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_required_interface_stays_pending_during_startup() {
        let probe = TunnelProbe {
            required: true,
            ..TunnelProbe::default()
        };
        assert_eq!(probe.validate(), TunnelValidation::Pending);
    }

    #[test]
    fn proxy_mode_accepts_verified_egress_without_tun_traffic() {
        let probe = TunnelProbe {
            required: false,
            egress_ok: true,
            latency_ms: Some(50),
            ..TunnelProbe::default()
        };
        assert_eq!(probe.validate(), TunnelValidation::Healthy);
    }

    #[test]
    fn system_tunnel_stays_pending_until_real_interface_traffic_is_seen() {
        let probe = TunnelProbe {
            required: true,
            interface_up: true,
            egress_ok: true,
            latency_ms: Some(50),
            ..TunnelProbe::default()
        };
        assert_eq!(probe.validate(), TunnelValidation::Pending);
    }
}
