#![cfg_attr(all(target_os = "windows", not(test)), windows_subsystem = "windows")]

mod aether;
mod commands;
mod core_manager;
mod diagnostics;
mod error;
mod events;
mod focus;
mod singbox;
mod single_instance;
mod state;
mod telemetry;
mod traffic;
mod tray;
mod tun_helper;
mod xray;

use state::AppState;
use tauri::{Manager, WindowEvent};

#[cfg(windows)]
pub(crate) fn os_is_admin() -> bool {
    use windows_sys::Win32::UI::Shell::IsUserAnAdmin;
    unsafe { IsUserAnAdmin() != 0 }
}

#[cfg(unix)]
pub(crate) fn os_is_admin() -> bool {
    std::process::Command::new("id")
        .arg("-u")
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).trim() == "0")
        .unwrap_or(false)
}

/// Compatibility gate used by the existing connection supervisor. On Windows,
/// a standard-user GUI can satisfy privileged TUN work through the detached
/// helper, so the supervisor must not demand a whole-app relaunch. Callers that
/// need the process's actual integrity level must use `os_is_admin()` instead.
pub(crate) fn is_admin() -> bool {
    os_is_admin() || tun_helper::is_supported()
}

#[cfg(windows)]
#[cfg_attr(debug_assertions, allow(dead_code))]
pub(crate) fn relaunch_as_admin() -> bool {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let Ok(exe) = std::env::current_exe() else {
        return false;
    };
    let mut exe_wide: Vec<u16> = exe.as_os_str().encode_wide().collect();
    exe_wide.push(0);
    let verb: Vec<u16> = "runas\0".encode_utf16().collect();

    // The elevated process is the intentional replacement instance. Release the
    // guard immediately before ShellExecute and reacquire it if UAC is cancelled
    // or process creation fails.
    single_instance::release_for_handoff();
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            exe_wide.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    let launched = result as isize > 32;
    if !launched {
        let _ = single_instance::acquire();
    }
    launched
}

#[cfg(target_os = "linux")]
#[cfg_attr(debug_assertions, allow(dead_code))]
pub(crate) fn relaunch_as_admin() -> bool {
    let Ok(exe) = std::env::current_exe() else {
        return false;
    };
    std::process::Command::new("pkexec")
        .arg(exe)
        .spawn()
        .is_ok()
}

#[cfg(target_os = "macos")]
#[cfg_attr(debug_assertions, allow(dead_code))]
pub(crate) fn relaunch_as_admin() -> bool {
    let Ok(exe) = std::env::current_exe() else {
        return false;
    };
    let path = exe
        .display()
        .to_string()
        .replace('\\', "\\\\")
        .replace('"', "\\\"");
    let script = format!(
        "do shell script \"\\\"{}\\\" >/dev/null 2>&1 &\" with administrator privileges",
        path
    );
    std::process::Command::new("osascript")
        .args(["-e", &script])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        diagnostics::record("panic", "error", info.to_string());
        default_hook(info);
    }));
}

fn main() {
    // The elevated TUN helper is the same executable in a headless internal
    // mode. Handle it before the single-instance guard and before Tauri creates
    // a WebView so privilege elevation never replaces or flashes the GUI.
    if let Some(exit_code) = tun_helper::run_if_requested() {
        std::process::exit(exit_code);
    }

    // Acquire ownership before touching PID files. Without this guard, launching
    // a second GUI could classify the first GUI's live Aether/TUN children as
    // orphans and terminate an otherwise healthy connection.
    if !single_instance::acquire() {
        single_instance::activate_existing_window();
        return;
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::default())
        .setup(|app| {
            let data_dir = app.handle().path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let log_path = diagnostics::init(&data_dir)?;
            install_panic_hook();
            diagnostics::record(
                "app",
                "info",
                format!(
                    "Aether-GUI {} starting on {}-{}; diagnostics={}",
                    env!("CARGO_PKG_VERSION"),
                    std::env::consts::OS,
                    std::env::consts::ARCH,
                    log_path.display()
                ),
            );

            aether::orphan::reap_orphan(&data_dir);
            singbox::reap_orphan(app.handle());
            let manager = app.state::<AppState>().manager.clone();
            telemetry::spawn_watcher(app.handle().clone(), manager.clone());
            focus::spawn_watcher(app.handle().clone());
            tray::init(app)?;
            tray::spawn_state_watcher(app.handle().clone(), manager);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_always_on_top(true);
                let _ = window.set_focus();
                let _ = window.set_always_on_top(false);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::connect,
            commands::disconnect,
            commands::get_status,
            commands::get_default_profile,
            commands::take_pending_elevation_profile,
            commands::set_default_profile,
            commands::get_close_to_tray,
            commands::set_close_to_tray,
            commands::sync_tray_state,
            commands::get_is_elevated,
            commands::elevate,
            commands::prepare_app_relaunch,
            commands::restore_instance_guard,
            commands::get_tun_status,
            commands::get_traffic,
            commands::get_runtime_telemetry,
            commands::list_core_versions,
            commands::get_core_status,
            commands::install_core_version,
            commands::select_core_version,
            commands::remove_core_version,
            commands::get_diagnostics_path,
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
                diagnostics::record("app", "info", "application exit requested");
                aether::shutdown_blocking(&state.manager, &state.singbox, &data_dir);
                diagnostics::flush();
            }
        });
}
