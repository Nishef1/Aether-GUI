use crate::aether::{self, profiles::ConnectionProfile, AetherManager};
use crate::events::STATUS_EVENT;
use crate::runtime_error::RuntimeError;
use crate::state::ConnectionState;
use crate::system_tunnel::{
    SystemTunnelDescriptor, SystemTunnelRuntime, SystemTunnelSelection, TunnelContext,
};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub const DEFAULT_ENGINE_ID: &str = "aether";
const ACCESS_CODE_INTERACTION: &str = "access-code";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct EngineDescriptor {
    pub id: String,
    pub display_name: String,
    pub built_in: bool,
    pub capabilities: Vec<String>,
}

/// Stable process-boundary contract for transport engines.
///
/// Transport adapters expose a local SOCKS endpoint. Optional system-wide TUN
/// implementations are composed above this contract and never modify the
/// transport integration itself.
pub trait EngineAdapter: Send + Sync {
    fn id(&self) -> &'static str;
    fn descriptor(&self) -> EngineDescriptor;
    fn prepare(&self, data_dir: &Path) -> Result<(), RuntimeError>;
    fn connect(&self, app: AppHandle, profile: Option<Value>) -> Result<(), RuntimeError>;
    fn disconnect(&self, app: &AppHandle) -> Result<(), RuntimeError>;
    fn submit_interaction(&self, interaction: &str, payload: Value) -> Result<(), RuntimeError>;
    fn status(&self) -> ConnectionState;
    fn default_profile(&self, app: &AppHandle) -> Result<Value, RuntimeError>;
    fn set_default_profile(&self, app: &AppHandle, profile: Value) -> Result<(), RuntimeError>;
    fn shutdown(&self, data_dir: &Path);
}

struct AetherAdapter {
    manager: Arc<Mutex<AetherManager>>,
}

impl Default for AetherAdapter {
    fn default() -> Self {
        Self {
            manager: Arc::new(Mutex::new(AetherManager::new())),
        }
    }
}

impl EngineAdapter for AetherAdapter {
    fn id(&self) -> &'static str {
        DEFAULT_ENGINE_ID
    }

    fn descriptor(&self) -> EngineDescriptor {
        EngineDescriptor {
            id: self.id().into(),
            display_name: "Aether".into(),
            built_in: true,
            capabilities: [
                "masque",
                "wireguard",
                "gool",
                "zero-trust",
                "routing",
                "dns",
                "interactive-access-code",
                "socks5",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
        }
    }

    fn prepare(&self, data_dir: &Path) -> Result<(), RuntimeError> {
        std::fs::create_dir_all(data_dir)
            .map_err(|error| RuntimeError::Internal(error.to_string()))?;
        aether::orphan::reap_orphan(data_dir);
        Ok(())
    }

    fn connect(&self, app: AppHandle, profile: Option<Value>) -> Result<(), RuntimeError> {
        let profile = profile
            .map(serde_json::from_value::<ConnectionProfile>)
            .transpose()
            .map_err(|error| RuntimeError::InvalidProfile {
                engine: self.id().into(),
                message: error.to_string(),
            })?;
        aether::start_connect(app, self.manager.clone(), profile).map_err(RuntimeError::from)
    }

    fn disconnect(&self, app: &AppHandle) -> Result<(), RuntimeError> {
        aether::request_disconnect(app, &self.manager).map_err(RuntimeError::from)
    }

    fn submit_interaction(&self, interaction: &str, payload: Value) -> Result<(), RuntimeError> {
        if interaction != ACCESS_CODE_INTERACTION {
            return Err(RuntimeError::UnsupportedInteraction {
                engine: self.id().into(),
                interaction: interaction.into(),
            });
        }
        let code = payload
            .as_str()
            .ok_or_else(|| RuntimeError::InvalidProfile {
                engine: self.id().into(),
                message: "access-code payload must be a string".into(),
            })?;
        aether::submit_access_code(&self.manager, code.to_owned()).map_err(RuntimeError::from)
    }

    fn status(&self) -> ConnectionState {
        self.manager
            .lock()
            .map(|manager| manager.status())
            .unwrap_or(ConnectionState::Error {
                message: "Tunnel runtime state is unavailable".into(),
                phase: "runtime".into(),
            })
    }

    fn default_profile(&self, app: &AppHandle) -> Result<Value, RuntimeError> {
        serde_json::to_value(aether::profiles::load(app))
            .map_err(|error| RuntimeError::Internal(error.to_string()))
    }

    fn set_default_profile(&self, app: &AppHandle, profile: Value) -> Result<(), RuntimeError> {
        let profile = serde_json::from_value::<ConnectionProfile>(profile).map_err(|error| {
            RuntimeError::InvalidProfile {
                engine: self.id().into(),
                message: error.to_string(),
            }
        })?;
        aether::profiles::save(app, &profile);
        Ok(())
    }

    fn shutdown(&self, data_dir: &Path) {
        aether::shutdown_blocking(&self.manager, data_dir);
    }
}

pub struct EngineRuntime {
    adapters: BTreeMap<String, Arc<dyn EngineAdapter>>,
    active_engine: Mutex<String>,
    system_tunnel: Arc<SystemTunnelRuntime>,
    connection_generation: AtomicU64,
}

impl Default for EngineRuntime {
    fn default() -> Self {
        let aether: Arc<dyn EngineAdapter> = Arc::new(AetherAdapter::default());
        let mut adapters = BTreeMap::new();
        adapters.insert(aether.id().to_owned(), aether);
        Self {
            adapters,
            active_engine: Mutex::new(DEFAULT_ENGINE_ID.into()),
            system_tunnel: Arc::new(SystemTunnelRuntime::default()),
            connection_generation: AtomicU64::new(0),
        }
    }
}

impl EngineRuntime {
    fn adapter(&self, requested: Option<&str>) -> Result<Arc<dyn EngineAdapter>, RuntimeError> {
        let id = match requested {
            Some(id) => id.to_owned(),
            None => self
                .active_engine
                .lock()
                .map_err(|_| RuntimeError::Internal("active engine lock is poisoned".into()))?
                .clone(),
        };
        self.adapters
            .get(&id)
            .cloned()
            .ok_or(RuntimeError::UnknownEngine(id))
    }

    pub fn prepare_all(&self, app: &AppHandle, data_dir: &Path) -> Result<(), RuntimeError> {
        for adapter in self.adapters.values() {
            adapter.prepare(data_dir)?;
        }
        self.system_tunnel.prepare_all(app, data_dir)
    }

    pub fn shutdown_all(&self, app: &AppHandle, data_dir: &Path) {
        self.connection_generation.fetch_add(1, Ordering::SeqCst);
        self.system_tunnel.shutdown_all(app, data_dir);
        for adapter in self.adapters.values() {
            adapter.shutdown(data_dir);
        }
    }

    pub fn list(&self) -> Vec<EngineDescriptor> {
        self.adapters
            .values()
            .map(|adapter| adapter.descriptor())
            .collect()
    }

    pub fn active_engine(&self) -> String {
        self.active_engine
            .lock()
            .map(|id| id.clone())
            .unwrap_or_else(|_| DEFAULT_ENGINE_ID.into())
    }

    pub fn connect(
        self: &Arc<Self>,
        app: AppHandle,
        engine_id: Option<&str>,
        profile: Option<Value>,
    ) -> Result<(), RuntimeError> {
        let adapter = self.adapter(engine_id)?;
        let generation = self.connection_generation.fetch_add(1, Ordering::SeqCst) + 1;
        let tunnel_epoch = self.system_tunnel.begin_attempt(&app);

        if let Err(error) = adapter.connect(app.clone(), profile) {
            self.system_tunnel.cancel_attempt(&app);
            return Err(error);
        }
        *self
            .active_engine
            .lock()
            .map_err(|_| RuntimeError::Internal("active engine lock is poisoned".into()))? =
            adapter.id().into();

        self.spawn_system_tunnel_supervisor(app, adapter, generation, tunnel_epoch);
        Ok(())
    }

    fn spawn_system_tunnel_supervisor(
        self: &Arc<Self>,
        app: AppHandle,
        adapter: Arc<dyn EngineAdapter>,
        generation: u64,
        tunnel_epoch: u64,
    ) {
        let runtime = Arc::clone(self);
        std::thread::spawn(move || loop {
            if runtime.connection_generation.load(Ordering::SeqCst) != generation {
                return;
            }

            match adapter.status() {
                ConnectionState::Connected {
                    socks_addr,
                    connected_at_ms,
                } => {
                    if runtime.system_tunnel.selection() == SystemTunnelSelection::Off {
                        return;
                    }
                    if !runtime.system_tunnel.is_active() {
                        let context = TunnelContext {
                            upstream_socks_addr: socks_addr,
                            connected_at_ms,
                        };
                        match runtime.system_tunnel.start_selected(&app, context, tunnel_epoch) {
                            Ok(true) => {}
                            Ok(false) => return,
                            Err(error) => {
                                runtime.finish_system_tunnel_failure(
                                    &app,
                                    &adapter,
                                    generation,
                                    error.to_string(),
                                );
                                return;
                            }
                        }
                    }
                    match runtime.system_tunnel.poll_active_failure(&app) {
                        Ok(Some(message)) => {
                            runtime.finish_system_tunnel_failure(
                                &app,
                                &adapter,
                                generation,
                                message,
                            );
                            return;
                        }
                        Ok(None) => {}
                        Err(error) => {
                            runtime.finish_system_tunnel_failure(
                                &app,
                                &adapter,
                                generation,
                                error.to_string(),
                            );
                            return;
                        }
                    }
                }
                ConnectionState::Launching
                | ConnectionState::Connecting
                | ConnectionState::Reconnecting { .. } => {
                    runtime.system_tunnel.stop_for_transport_loss(&app);
                }
                ConnectionState::Idle
                | ConnectionState::Disconnecting
                | ConnectionState::Error { .. } => {
                    runtime.system_tunnel.stop_for_transport_loss(&app);
                    return;
                }
                ConnectionState::StartingTunnel { .. } | ConnectionState::Tunneling { .. } => {}
            }

            std::thread::sleep(Duration::from_millis(250));
        });
    }

    fn finish_system_tunnel_failure(
        &self,
        app: &AppHandle,
        adapter: &Arc<dyn EngineAdapter>,
        generation: u64,
        message: String,
    ) {
        let _ = adapter.disconnect(app);
        for _ in 0..20 {
            if self.connection_generation.load(Ordering::SeqCst) != generation {
                return;
            }
            if matches!(
                adapter.status(),
                ConnectionState::Idle | ConnectionState::Error { .. }
            ) {
                break;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        if self.connection_generation.load(Ordering::SeqCst) != generation {
            return;
        }
        self.system_tunnel.publish_error(message.clone());
        let _ = app.emit(
            STATUS_EVENT,
            &ConnectionState::Error {
                message,
                phase: "system-tunnel".into(),
            },
        );
    }

    pub fn disconnect(&self, app: &AppHandle) -> Result<(), RuntimeError> {
        self.connection_generation.fetch_add(1, Ordering::SeqCst);
        self.system_tunnel.cancel_attempt(app);
        self.adapter(None)?.disconnect(app)
    }

    pub fn submit_interaction(
        &self,
        engine_id: Option<&str>,
        interaction: &str,
        payload: Value,
    ) -> Result<(), RuntimeError> {
        self.adapter(engine_id)?
            .submit_interaction(interaction, payload)
    }

    pub fn status(&self) -> ConnectionState {
        let transport = self
            .adapter(None)
            .map(|adapter| adapter.status())
            .unwrap_or(ConnectionState::Idle);
        self.system_tunnel.decorate(transport)
    }

    pub fn default_profile(
        &self,
        app: &AppHandle,
        engine_id: Option<&str>,
    ) -> Result<Value, RuntimeError> {
        self.adapter(engine_id)?.default_profile(app)
    }

    pub fn set_default_profile(
        &self,
        app: &AppHandle,
        engine_id: Option<&str>,
        profile: Value,
    ) -> Result<(), RuntimeError> {
        self.adapter(engine_id)?.set_default_profile(app, profile)
    }

    pub fn list_system_tunnels(&self) -> Vec<SystemTunnelDescriptor> {
        self.system_tunnel.list()
    }

    pub fn system_tunnel_selection(&self) -> SystemTunnelSelection {
        self.system_tunnel.selection()
    }

    pub fn set_system_tunnel_selection(
        &self,
        app: &AppHandle,
        selection: SystemTunnelSelection,
    ) -> Result<(), RuntimeError> {
        if !matches!(self.status(), ConnectionState::Idle | ConnectionState::Error { .. }) {
            return Err(RuntimeError::SystemTunnelBusy);
        }
        self.system_tunnel.set_selection(app, selection)
    }

    pub fn traffic_interface(&self) -> Option<&'static str> {
        self.system_tunnel.traffic_interface()
    }

    pub fn connect_aether(
        self: &Arc<Self>,
        app: AppHandle,
        profile: Option<ConnectionProfile>,
    ) -> Result<(), RuntimeError> {
        let profile = profile
            .map(serde_json::to_value)
            .transpose()
            .map_err(|error| RuntimeError::Internal(error.to_string()))?;
        self.connect(app, Some(DEFAULT_ENGINE_ID), profile)
    }

    pub fn aether_default_profile(
        &self,
        app: &AppHandle,
    ) -> Result<ConnectionProfile, RuntimeError> {
        let value = self.default_profile(app, Some(DEFAULT_ENGINE_ID))?;
        serde_json::from_value(value).map_err(|error| RuntimeError::InvalidProfile {
            engine: DEFAULT_ENGINE_ID.into(),
            message: error.to_string(),
        })
    }

    pub fn set_aether_default_profile(
        &self,
        app: &AppHandle,
        profile: ConnectionProfile,
    ) -> Result<(), RuntimeError> {
        let value = serde_json::to_value(profile)
            .map_err(|error| RuntimeError::Internal(error.to_string()))?;
        self.set_default_profile(app, Some(DEFAULT_ENGINE_ID), value)
    }

    pub fn submit_aether_access_code(&self, code: String) -> Result<(), RuntimeError> {
        self.submit_interaction(
            Some(DEFAULT_ENGINE_ID),
            ACCESS_CODE_INTERACTION,
            Value::String(code),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_exposes_aether_as_stable_default() {
        let runtime = EngineRuntime::default();
        assert_eq!(runtime.active_engine(), DEFAULT_ENGINE_ID);
        assert_eq!(runtime.list().len(), 1);
        assert_eq!(runtime.list()[0].id, DEFAULT_ENGINE_ID);
    }

    #[test]
    fn sing_box_is_a_separate_system_tunnel_not_a_transport() {
        let runtime = EngineRuntime::default();
        assert_eq!(runtime.list().len(), 1);
        assert_eq!(runtime.list_system_tunnels().len(), 1);
        assert_eq!(runtime.list_system_tunnels()[0].id, "singbox");
    }

    #[test]
    fn unknown_engine_is_rejected_before_launch() {
        let runtime = EngineRuntime::default();
        assert!(matches!(
            runtime.adapter(Some("missing")),
            Err(RuntimeError::UnknownEngine(id)) if id == "missing"
        ));
    }
}
