pub mod sing_box;

use crate::events::STATUS_EVENT;
use crate::runtime_error::RuntimeError;
use crate::state::ConnectionState;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "settings.json";
const STORE_KEY: &str = "system_tunnel";
pub const SING_BOX_TUNNEL_ID: &str = "singbox";

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SystemTunnelSelection {
    #[default]
    Off,
    Singbox,
}

impl SystemTunnelSelection {
    pub fn id(self) -> Option<&'static str> {
        match self {
            Self::Off => None,
            Self::Singbox => Some(SING_BOX_TUNNEL_ID),
        }
    }

    fn from_store(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            SING_BOX_TUNNEL_ID => Self::Singbox,
            _ => Self::Off,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SystemTunnelDescriptor {
    pub id: String,
    pub display_name: String,
    pub requires_elevation: bool,
    pub capabilities: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct TunnelContext {
    pub upstream_socks_addr: String,
    pub connected_at_ms: u64,
}

/// Stable boundary for system-wide TUN implementations.
///
/// A transport engine (Aether today) exposes a loopback SOCKS endpoint. A
/// system-tunnel adapter consumes that endpoint and owns OS routing, elevation,
/// process lifecycle and traffic-interface reporting. Keeping this separate
/// prevents a sing-box update from touching Aether integration code.
pub trait SystemTunnelAdapter: Send + Sync {
    fn id(&self) -> &'static str;
    fn descriptor(&self) -> SystemTunnelDescriptor;
    fn prepare(&self, app: &AppHandle, data_dir: &Path) -> Result<(), RuntimeError>;
    fn start(&self, app: &AppHandle, context: &TunnelContext) -> Result<(), RuntimeError>;
    fn stop(&self, app: &AppHandle);
    fn is_running(&self) -> bool;
    fn is_active(&self) -> bool;
    fn poll_exit(&self) -> Result<Option<String>, RuntimeError>;
    fn traffic_interface(&self) -> Option<&'static str>;
    fn shutdown(&self, app: &AppHandle, data_dir: &Path);
}

#[derive(Clone, Debug)]
enum TunnelStage {
    Idle,
    Starting(TunnelContext),
    Active(TunnelContext),
    Error(String),
}

pub struct SystemTunnelRuntime {
    adapters: BTreeMap<String, Arc<dyn SystemTunnelAdapter>>,
    selection: Mutex<SystemTunnelSelection>,
    stage: Mutex<TunnelStage>,
    attempt_epoch: AtomicU64,
}

impl Default for SystemTunnelRuntime {
    fn default() -> Self {
        let sing_box: Arc<dyn SystemTunnelAdapter> = Arc::new(sing_box::SingBoxTunnel::default());
        let mut adapters = BTreeMap::new();
        adapters.insert(sing_box.id().to_owned(), sing_box);
        Self {
            adapters,
            selection: Mutex::new(SystemTunnelSelection::Off),
            stage: Mutex::new(TunnelStage::Idle),
            attempt_epoch: AtomicU64::new(0),
        }
    }
}

impl SystemTunnelRuntime {
    fn adapter_for_selection(
        &self,
        selection: SystemTunnelSelection,
    ) -> Result<Option<Arc<dyn SystemTunnelAdapter>>, RuntimeError> {
        let Some(id) = selection.id() else {
            return Ok(None);
        };
        self.adapters
            .get(id)
            .cloned()
            .map(Some)
            .ok_or_else(|| RuntimeError::UnknownSystemTunnel(id.into()))
    }

    fn current_selection(&self) -> SystemTunnelSelection {
        self.selection.lock().map(|value| *value).unwrap_or_default()
    }

    fn stage_is_configurable(&self) -> bool {
        self.stage
            .lock()
            .map(|stage| matches!(&*stage, TunnelStage::Idle | TunnelStage::Error(_)))
            .unwrap_or(false)
            && self.adapters.values().all(|adapter| !adapter.is_running())
    }

    pub fn prepare_all(&self, app: &AppHandle, data_dir: &Path) -> Result<(), RuntimeError> {
        let stored = app
            .store(STORE_FILE)
            .ok()
            .and_then(|store| store.get(STORE_KEY))
            .and_then(|value| value.as_str().map(SystemTunnelSelection::from_store))
            .unwrap_or_default();
        if let Ok(mut selection) = self.selection.lock() {
            *selection = stored;
        }
        for adapter in self.adapters.values() {
            adapter.prepare(app, data_dir)?;
        }
        Ok(())
    }

    pub fn list(&self) -> Vec<SystemTunnelDescriptor> {
        self.adapters
            .values()
            .map(|adapter| adapter.descriptor())
            .collect()
    }

    pub fn selection(&self) -> SystemTunnelSelection {
        self.current_selection()
    }

    pub fn set_selection(
        &self,
        app: &AppHandle,
        selection: SystemTunnelSelection,
    ) -> Result<(), RuntimeError> {
        if !self.stage_is_configurable() {
            return Err(RuntimeError::SystemTunnelBusy);
        }
        self.adapter_for_selection(selection)?;

        let store = app
            .store(STORE_FILE)
            .map_err(|error| RuntimeError::Internal(error.to_string()))?;
        store.set(
            STORE_KEY,
            serde_json::Value::String(selection.id().unwrap_or("off").into()),
        );
        store
            .save()
            .map_err(|error| RuntimeError::Internal(error.to_string()))?;

        *self
            .selection
            .lock()
            .map_err(|_| RuntimeError::Internal("system tunnel lock is poisoned".into()))? =
            selection;
        if let Ok(mut stage) = self.stage.lock() {
            *stage = TunnelStage::Idle;
        }
        Ok(())
    }

    /// Start a new connection lineage and invalidate any startup still running
    /// for a previous connect click.
    pub fn begin_attempt(&self, app: &AppHandle) -> u64 {
        let epoch = self.attempt_epoch.fetch_add(1, Ordering::SeqCst) + 1;
        self.stop_for_transport_loss(app);
        epoch
    }

    pub fn cancel_attempt(&self, app: &AppHandle) {
        self.attempt_epoch.fetch_add(1, Ordering::SeqCst);
        self.stop_for_transport_loss(app);
    }

    pub fn start_selected(
        &self,
        app: &AppHandle,
        context: TunnelContext,
        epoch: u64,
    ) -> Result<bool, RuntimeError> {
        if self.attempt_epoch.load(Ordering::SeqCst) != epoch {
            return Ok(false);
        }
        let selection = self.current_selection();
        let Some(adapter) = self.adapter_for_selection(selection)? else {
            if let Ok(mut stage) = self.stage.lock() {
                *stage = TunnelStage::Idle;
            }
            return Ok(false);
        };

        {
            let mut stage = self
                .stage
                .lock()
                .map_err(|_| RuntimeError::Internal("system tunnel state is unavailable".into()))?;
            *stage = TunnelStage::Starting(context.clone());
        }
        let _ = app.emit(
            STATUS_EVENT,
            &ConnectionState::StartingTunnel {
                tunnel: adapter.id().into(),
                socks_addr: context.upstream_socks_addr.clone(),
                connected_at_ms: context.connected_at_ms,
            },
        );

        let result = adapter.start(app, &context);
        if self.attempt_epoch.load(Ordering::SeqCst) != epoch {
            adapter.stop(app);
            if let Ok(mut stage) = self.stage.lock() {
                *stage = TunnelStage::Idle;
            }
            return Ok(false);
        }

        if let Err(error) = result {
            if let Ok(mut stage) = self.stage.lock() {
                *stage = TunnelStage::Error(error.to_string());
            }
            return Err(error);
        }

        {
            let mut stage = self
                .stage
                .lock()
                .map_err(|_| RuntimeError::Internal("system tunnel state is unavailable".into()))?;
            *stage = TunnelStage::Active(context.clone());
        }
        let _ = app.emit(
            STATUS_EVENT,
            &ConnectionState::Tunneling {
                tunnel: adapter.id().into(),
                socks_addr: context.upstream_socks_addr,
                connected_at_ms: context.connected_at_ms,
            },
        );
        Ok(true)
    }

    pub fn stop_for_transport_loss(&self, app: &AppHandle) {
        for adapter in self.adapters.values() {
            adapter.stop(app);
        }
        if let Ok(mut stage) = self.stage.lock() {
            *stage = TunnelStage::Idle;
        }
    }

    pub fn poll_active_failure(&self, app: &AppHandle) -> Result<Option<String>, RuntimeError> {
        let stage_is_live = self
            .stage
            .lock()
            .map(|stage| matches!(&*stage, TunnelStage::Starting(_) | TunnelStage::Active(_)))
            .unwrap_or(false);
        if !stage_is_live {
            return Ok(None);
        }

        let Some(adapter) = self.adapter_for_selection(self.current_selection())? else {
            return Ok(None);
        };
        let Some(message) = adapter.poll_exit()? else {
            return Ok(None);
        };
        adapter.stop(app);
        if let Ok(mut stage) = self.stage.lock() {
            *stage = TunnelStage::Error(message.clone());
        }
        Ok(Some(message))
    }

    pub fn publish_error(&self, message: String) {
        if let Ok(mut stage) = self.stage.lock() {
            *stage = TunnelStage::Error(message);
        }
    }

    pub fn is_active(&self) -> bool {
        self.stage
            .lock()
            .map(|stage| matches!(&*stage, TunnelStage::Active(_)))
            .unwrap_or(false)
    }

    pub fn decorate(&self, transport: ConnectionState) -> ConnectionState {
        if self.current_selection() == SystemTunnelSelection::Off {
            return transport;
        }
        let Ok(stage) = self.stage.lock() else {
            return transport;
        };
        match (&*stage, &transport) {
            (TunnelStage::Starting(context), ConnectionState::Connected { .. }) => {
                ConnectionState::StartingTunnel {
                    tunnel: self
                        .current_selection()
                        .id()
                        .unwrap_or(SING_BOX_TUNNEL_ID)
                        .into(),
                    socks_addr: context.upstream_socks_addr.clone(),
                    connected_at_ms: context.connected_at_ms,
                }
            }
            (TunnelStage::Active(context), ConnectionState::Connected { .. }) => {
                ConnectionState::Tunneling {
                    tunnel: self
                        .current_selection()
                        .id()
                        .unwrap_or(SING_BOX_TUNNEL_ID)
                        .into(),
                    socks_addr: context.upstream_socks_addr.clone(),
                    connected_at_ms: context.connected_at_ms,
                }
            }
            (TunnelStage::Error(message), _) => ConnectionState::Error {
                message: message.clone(),
                phase: "system-tunnel".into(),
            },
            _ => transport,
        }
    }

    pub fn traffic_interface(&self) -> Option<&'static str> {
        if !self.is_active() {
            return None;
        }
        self.adapter_for_selection(self.current_selection())
            .ok()
            .flatten()
            .and_then(|adapter| adapter.traffic_interface())
    }

    pub fn shutdown_all(&self, app: &AppHandle, data_dir: &Path) {
        self.attempt_epoch.fetch_add(1, Ordering::SeqCst);
        for adapter in self.adapters.values() {
            adapter.shutdown(app, data_dir);
        }
        if let Ok(mut stage) = self.stage.lock() {
            *stage = TunnelStage::Idle;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_keeps_upstream_proxy_mode() {
        let runtime = SystemTunnelRuntime::default();
        assert_eq!(runtime.selection(), SystemTunnelSelection::Off);
        assert_eq!(runtime.list().len(), 1);
        assert_eq!(runtime.list()[0].id, SING_BOX_TUNNEL_ID);
    }

    #[test]
    fn selection_ids_are_stable() {
        assert_eq!(SystemTunnelSelection::Off.id(), None);
        assert_eq!(SystemTunnelSelection::Singbox.id(), Some(SING_BOX_TUNNEL_ID));
    }
}
