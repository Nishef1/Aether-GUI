#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod aether;
mod commands;
mod engine;
mod error;
mod events;
mod focus;
mod runtime_error;
mod state;
mod tray;

use state::AppState;
use tauri::{Manager, WindowEvent};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(AppState::default())
        .setup(|app| {
            let data_dir = app.handle().path().app_data_dir()?;
            let state = app.state::<AppState>();
            state.runtime.prepare_all(&data_dir)?;
            focus::spawn_watcher(app.handle().clone());
            tray::init(app)?;
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
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                let state = app_handle.state::<AppState>();
                let data_dir = app_handle
                    .path()
                    .app_data_dir()
                    .unwrap_or_else(|_| std::env::temp_dir());
                state.runtime.shutdown_all(&data_dir);
            }
        });
}
