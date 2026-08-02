#![cfg(target_os = "android")]

use serde::{Deserialize, Serialize, Serializer};
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, Runtime,
};

const PLUGIN_IDENTIFIER: &str = "com.cluvexstudio.aethergui.vpn";

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    PluginInvoke(#[from] tauri::plugin::mobile::PluginInvokeError),
}

fn serialize_mobile_protocol<S>(
    protocol: &str,
    serializer: S,
) -> std::result::Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.serialize_str(if protocol == "auto" { "masque" } else { protocol })
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VpnProfile {
    #[serde(serialize_with = "serialize_mobile_protocol")]
    pub protocol: String,
    pub scan_mode: String,
    pub ip_version: String,
    pub connection_mode: String,
    pub tun_engine: String,
    pub quick_reconnect: bool,
    pub masque_http2: bool,
    pub masque_noize: String,
    pub wg_noize: String,
    pub dns_server: String,
    pub dns: String,
    pub bind_address: String,
    pub webrtc_leak_protection: bool,
    pub mtu: u16,
    pub peer: String,
    pub wg_peer: String,
    pub h2_peer: String,
    pub ech: String,
    pub no_data_check: bool,
    pub validate_secs: u16,
    pub reconnect_secs: u16,
    pub fragment: bool,
    pub fragment_size: String,
    pub fragment_delay: String,
    pub keepalive: u16,
    pub no_profile_retry: bool,
    pub tls_groups: String,
    pub perf_profile: String,
    pub zero_trust_team: String,
    pub zero_trust_auth: String,
    pub access_email: String,
    pub access_client_id: String,
    pub access_client_secret: String,
    pub access_token: String,
    pub zero_trust_gateway: bool,
    pub route_block: String,
    pub route_direct: String,
    pub routes_file: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VpnStatus {
    pub state: String,
    pub message: Option<String>,
    pub socks_addr: Option<String>,
    pub tun_addr: Option<String>,
    pub connected_at_ms: Option<u64>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrafficStats {
    pub received_bytes: u64,
    pub sent_bytes: u64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTelemetry {
    pub received_bytes: u64,
    pub sent_bytes: u64,
    pub public_ip: Option<String>,
    pub country_code: Option<String>,
    pub latency_ms: Option<u64>,
    pub sampled_at_ms: u64,
    pub egress_probe_complete: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeLogEntry {
    pub id: u64,
    pub timestamp: u64,
    pub line: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeLogBatch {
    pub entries: Vec<NativeLogEntry>,
    pub last_id: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeLogRequest {
    after_id: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoggingRequest {
    enabled: bool,
}

#[derive(Clone, Debug, Serialize)]
struct AccessCodeRequest<'a> {
    code: &'a str,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoggingStatus {
    pub enabled: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareResult {
    pub prepared: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsResult {
    pub path: String,
    #[serde(default)]
    pub persistent: bool,
}

pub struct AetherVpn<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> AetherVpn<R> {
    pub fn prepare(&self) -> Result<PrepareResult> {
        self.0.run_mobile_plugin("prepare", ()).map_err(Into::into)
    }

    pub fn start(&self, profile: VpnProfile) -> Result<VpnStatus> {
        self.0.run_mobile_plugin("start", profile).map_err(Into::into)
    }

    pub fn stop(&self) -> Result<VpnStatus> {
        self.0.run_mobile_plugin("stop", ()).map_err(Into::into)
    }

    pub fn status(&self) -> Result<VpnStatus> {
        self.0.run_mobile_plugin("status", ()).map_err(Into::into)
    }

    pub fn traffic(&self) -> Result<TrafficStats> {
        self.0.run_mobile_plugin("traffic", ()).map_err(Into::into)
    }

    pub fn telemetry(&self) -> Result<RuntimeTelemetry> {
        self.0.run_mobile_plugin("telemetry", ()).map_err(Into::into)
    }

    pub fn logs(&self, after_id: u64) -> Result<NativeLogBatch> {
        self.0
            .run_mobile_plugin("logs", NativeLogRequest { after_id })
            .map_err(Into::into)
    }

    pub fn set_logging(&self, enabled: bool) -> Result<LoggingStatus> {
        self.0
            .run_mobile_plugin("setLogging", LoggingRequest { enabled })
            .map_err(Into::into)
    }

    pub fn submit_access_code(&self, code: &str) -> Result<()> {
        self.0
            .run_mobile_plugin::<()>("submitAccessCode", AccessCodeRequest { code })
            .map_err(Into::into)
    }

    pub fn diagnostics(&self) -> Result<DiagnosticsResult> {
        self.0.run_mobile_plugin("diagnostics", ()).map_err(Into::into)
    }
}

pub trait AetherVpnExt<R: Runtime> {
    fn aether_vpn(&self) -> &AetherVpn<R>;
}

impl<R: Runtime, T: Manager<R>> AetherVpnExt<R> for T {
    fn aether_vpn(&self) -> &AetherVpn<R> {
        self.state::<AetherVpn<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("aether-vpn")
        .setup(|app, api| {
            let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "FinalAetherVpnPlugin")?;
            app.manage(AetherVpn(handle));
            Ok(())
        })
        .build()
}
