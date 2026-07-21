use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

/// Global flag — toggled from the frontend via the `set_close_to_tray` command
/// and persisted to disk via `tauri-plugin-store`. Using an atomic here instead
/// of the store directly because the `on_window_event` callback fires on every
/// close and reading the store there would be wasteful.
static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(false);

const STORE_FILE: &str = "settings.json";
const STORE_KEY: &str = "close_to_tray";
const TRAY_ID: &str = "aether-main";

pub fn get_close_to_tray() -> bool {
    CLOSE_TO_TRAY.load(Ordering::Relaxed)
}

pub fn set_close_to_tray(app: &AppHandle, enabled: bool) {
    CLOSE_TO_TRAY.store(enabled, Ordering::Relaxed);
    // Persist so it survives restarts.
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app.store(STORE_FILE) {
        store.set(STORE_KEY, serde_json::Value::Bool(enabled));
        let _ = store.save();
    }
}

/// Load persisted preference and sync the atomic.
fn load_preference(app: &AppHandle) {
    use tauri_plugin_store::StoreExt;
    let enabled = app
        .store(STORE_FILE)
        .ok()
        .and_then(|s| s.get(STORE_KEY))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    CLOSE_TO_TRAY.store(enabled, Ordering::Relaxed);
}

fn visual_for_state(state: &str) -> ([u8; 3], &'static str) {
    match state {
        "Connected" | "Tunneling" => ([52, 211, 153], "Connected"),
        "Launching" | "Connecting" | "StartingTunnel" | "Reconnecting" | "Disconnecting" => {
            ([249, 115, 22], "Working")
        }
        "Error" => ([239, 68, 68], "Connection error"),
        _ => ([148, 163, 184], "Disconnected"),
    }
}

fn tinted_icon(base: &Image<'_>, color: [u8; 3]) -> Image<'static> {
    let mut rgba = base.rgba().to_vec();
    for pixel in rgba.chunks_exact_mut(4) {
        if pixel[3] == 0 {
            continue;
        }
        pixel[0] = color[0];
        pixel[1] = color[1];
        pixel[2] = color[2];
    }
    Image::new_owned(rgba, base.width(), base.height())
}

/// Keep the tray as a compact, glanceable representation of the real connection
/// state. The frontend calls this whenever it receives a backend status event;
/// hidden-to-tray windows still keep their listeners alive, so the icon remains
/// current without adding another state store in Rust.
pub fn set_visual_state(app: &AppHandle, state: &str) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let Some(base) = app.default_window_icon() else {
        return;
    };
    let (color, label) = visual_for_state(state);
    let _ = tray.set_icon(Some(tinted_icon(base, color)));
    let _ = tray.set_tooltip(Some(format!("Aether-GUI — {label}")));
}

/// Create the system-tray icon, menu, and event handlers. Call from `setup`.
pub fn init(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    load_preference(app.handle());

    let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Aether-GUI — Disconnected")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(tinted_icon(icon, [148, 163, 184]));
    }

    builder.build(app)?;
    Ok(())
}

fn show_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_flag_round_trips() {
        CLOSE_TO_TRAY.store(false, Ordering::Relaxed);
        assert!(!get_close_to_tray());
        CLOSE_TO_TRAY.store(true, Ordering::Relaxed);
        assert!(get_close_to_tray());
    }

    #[test]
    fn tray_visuals_cover_connection_lifecycle() {
        assert_eq!(visual_for_state("Idle").1, "Disconnected");
        assert_eq!(visual_for_state("Connecting").1, "Working");
        assert_eq!(visual_for_state("Tunneling").1, "Connected");
        assert_eq!(visual_for_state("Error").1, "Connection error");
    }
}
