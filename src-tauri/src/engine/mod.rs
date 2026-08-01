use crate::aether::{self, profiles::ConnectionProfile, AetherManager};
use crate::runtime_error::RuntimeError;
use crate::state::ConnectionState;
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;

pub const DEFAULT_ENGINE_ID: &str = "aether";
const ACCESS_CODE_INTERACTION: &str = "access-code";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct EngineDescriptor {
    pub id: String,
    pub display_name: String,
    pub built_in: bool,
    pub capabilities: Vec<String>,
}

/// Stable process-boundary contract for every tunnel engine.
///
/// Implementations own their process, profile serialization and lifecycle.
/// The UI/runtime only sees this contract, so adding a new engine does not
/// require editing the Aether integration or the upstream core itself.
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
}

impl Default for EngineRuntime {
    fn default() -> Self {
        let aether: Arc<dyn EngineAdapter> = Arc::new(AetherAdapter::default());
        let mut adapters = BTreeMap::new();
        adapters.insert(aether.id().to_owned(), aether);
        Self {
            adapters,
            active_engine: Mutex::new(DEFAULT_ENGINE_ID.into()),
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

    pub fn prepare_all(&self, data_dir: &Path) -> Result<(), RuntimeError> {
        for adapter in self.adapters.values() {
            adapter.prepare(data_dir)?;
        }
        Ok(())
    }

    pub fn shutdown_all(&self, data_dir: &Path) {
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
        &self,
        app: AppHandle,
        engine_id: Option<&str>,
        profile: Option<Value>,
    ) -> Result<(), RuntimeError> {
        let adapter = self.adapter(engine_id)?;
        adapter.connect(app, profile)?;
        *self
            .active_engine
            .lock()
            .map_err(|_| RuntimeError::Internal("active engine lock is poisoned".into()))? =
            adapter.id().into();
        Ok(())
    }

    pub fn disconnect(&self, app: &AppHandle) -> Result<(), RuntimeError> {
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
        self.adapter(None)
            .map(|adapter| adapter.status())
            .unwrap_or(ConnectionState::Idle)
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

    pub fn connect_aether(
        &self,
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
    fn unknown_engine_is_rejected_before_launch() {
        let runtime = EngineRuntime::default();
        assert!(matches!(
            runtime.adapter(Some("missing")),
            Err(RuntimeError::UnknownEngine(id)) if id == "missing"
        ));
    }
}
