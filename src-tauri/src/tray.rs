use crate::engine::EngineRuntime;
use crate::state::ConnectionState;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(false);

const STORE_FILE: &str = "settings.json";
const STORE_KEY: &str = "close_to_tray";
const TRAY_ID: &str = "aether-main";

pub fn get_close_to_tray() -> bool {
    CLOSE_TO_TRAY.load(Ordering::Relaxed)
}

pub fn set_close_to_tray(app: &AppHandle, enabled: bool) {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app.store(STORE_FILE) {
        store.set(STORE_KEY, serde_json::Value::Bool(enabled));
        if store.save().is_ok() {
            CLOSE_TO_TRAY.store(enabled, Ordering::Relaxed);
        }
    }
}

fn load_preference(app: &AppHandle) {
    use tauri_plugin_store::StoreExt;
    let enabled = app
        .store(STORE_FILE)
        .ok()
        .and_then(|store| store.get(STORE_KEY))
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    CLOSE_TO_TRAY.store(enabled, Ordering::Relaxed);
}

fn state_key(state: &ConnectionState) -> &'static str {
    match state {
        ConnectionState::Idle => "Idle",
        ConnectionState::Launching => "Launching",
        ConnectionState::Connecting => "Connecting",
        ConnectionState::Connected { .. } => "Connected",
        ConnectionState::StartingTunnel { .. } => "StartingTunnel",
        ConnectionState::Tunneling { .. } => "Tunneling",
        ConnectionState::Reconnecting { .. } => "Reconnecting",
        ConnectionState::Disconnecting => "Disconnecting",
        ConnectionState::Error { .. } => "Error",
    }
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

fn status_badged_icon(base: &Image<'_>, color: [u8; 3]) -> Image<'static> {
    let width = base.width() as i32;
    let height = base.height() as i32;
    let mut rgba = base.rgba().to_vec();
    if width <= 0 || height <= 0 {
        return Image::new_owned(rgba, base.width(), base.height());
    }

    let shortest = width.min(height);
    let radius = (shortest / 6).max(2);
    let border = (radius / 3).max(1);
    let margin = (shortest / 18).max(1);
    let center_x = width - radius - margin;
    let center_y = height - radius - margin;
    let outer_radius = radius + border;

    for y in (center_y - outer_radius).max(0)..=(center_y + outer_radius).min(height - 1) {
        for x in (center_x - outer_radius).max(0)..=(center_x + outer_radius).min(width - 1) {
            let dx = x - center_x;
            let dy = y - center_y;
            let distance_squared = dx * dx + dy * dy;
            let pixel_index = ((y * width + x) * 4) as usize;
            if distance_squared <= outer_radius * outer_radius {
                if distance_squared > radius * radius {
                    rgba[pixel_index] = 22;
                    rgba[pixel_index + 1] = 24;
                    rgba[pixel_index + 2] = 29;
                    rgba[pixel_index + 3] = 255;
                } else {
                    rgba[pixel_index] = color[0];
                    rgba[pixel_index + 1] = color[1];
                    rgba[pixel_index + 2] = color[2];
                    rgba[pixel_index + 3] = 255;
                }
            }
        }
    }
    Image::new_owned(rgba, base.width(), base.height())
}

fn set_visual_state(app: &AppHandle, state: &str) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let Some(base) = app.default_window_icon() else {
        return;
    };
    let (color, label) = visual_for_state(state);
    let _ = tray.set_icon(Some(status_badged_icon(base, color)));
    let _ = tray.set_tooltip(Some(format!("Aether-GUI — {label}")));
}

/// Native watcher keeps the tray accurate even when the WebView is hidden or
/// throttled by the operating system.
pub fn spawn_state_watcher(app: AppHandle, runtime: Arc<EngineRuntime>) {
    std::thread::spawn(move || {
        let mut last_state: Option<&'static str> = None;
        loop {
            let state = runtime.status();
            let key = state_key(&state);
            if last_state != Some(key) {
                set_visual_state(&app, key);
                last_state = Some(key);
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    });
}

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
        builder = builder.icon(status_badged_icon(icon, [148, 163, 184]));
    }
    builder.build(app)?;
    Ok(())
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
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
    fn visual_states_cover_the_full_connection_lifecycle() {
        assert_eq!(visual_for_state("Idle").1, "Disconnected");
        assert_eq!(visual_for_state("Connecting").1, "Working");
        assert_eq!(visual_for_state("StartingTunnel").1, "Working");
        assert_eq!(visual_for_state("Tunneling").1, "Connected");
        assert_eq!(visual_for_state("Error").1, "Connection error");
    }
}
