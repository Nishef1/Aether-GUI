#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod aether;
mod commands;
mod engine;
mod error;
mod events;
mod focus;
mod runtime_error;
mod state;
mod system_tunnel;
mod telemetry;
mod traffic;
mod tray;

use state::AppState;
use tauri::{Manager, WindowEvent};

fn shutdown_runtime(app_handle: &tauri::AppHandle) {
    let state = app_handle.state::<AppState>();
    if !state.begin_shutdown() {
        return;
    }
    let runtime = state.runtime.clone();
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    runtime.shutdown_all(app_handle, &data_dir);
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(AppState::default())
        .setup(|app| {
            let data_dir = app.handle().path().app_data_dir()?;
            // Clone the runtime out of Tauri state before mutably borrowing the
            // application for tray creation. This keeps setup borrow-safe while
            // all long-lived watchers share the same runtime instance.
            let runtime = app.state::<AppState>().runtime.clone();
            runtime.prepare_all(app.handle(), &data_dir)?;
            telemetry::spawn_watcher(app.handle().clone(), runtime.clone());
            focus::spawn_watcher(app.handle().clone());
            tray::init(app)?;
            tray::spawn_state_watcher(app.handle().clone(), runtime);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::connect,
            commands::disconnect,
            commands::submit_access_code,
            commands::get_status,
            commands::get_default_profile,
            commands::set_default_profile,
            commands::list_engines,
            commands::get_active_engine,
            commands::connect_engine,
            commands::get_engine_default_profile,
            commands::set_engine_default_profile,
            commands::submit_engine_interaction,
            commands::list_system_tunnels,
            commands::get_system_tunnel,
            commands::set_system_tunnel,
            commands::get_runtime_telemetry,
            commands::get_close_to_tray,
            commands::set_close_to_tray,
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if tray::get_close_to_tray() {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error building tauri application")
        .run(|app_handle, event| match event {
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                shutdown_runtime(app_handle);
            }
            _ => {}
        });
}
