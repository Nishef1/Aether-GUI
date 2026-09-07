use tauri::AppHandle;
#[cfg(windows)]
use tauri::Emitter;

/// Emits `app://focused` (bool) whenever the app gains or loses the
/// foreground. Exists because neither signal the webview can see is
/// trustworthy on Windows: tao's focus events fire inconsistently, its
/// `is_focused` false-negatives while the WebView2 child holds Win32 focus,
/// and the page's `document.hasFocus()` stays true even minimized. The
/// frontend pauses every animation on this event — a wrong value here means
/// either burning CPU in the background forever or a permanently frozen UI.
/// GetForegroundWindow is the OS's own ground truth. Polled at 1s and only
/// emitted on change; the first iteration always emits, which also fixes the
/// frontend's initial guess when the app starts in the background.
pub fn spawn_watcher(app: AppHandle) {
    #[cfg(windows)]
    std::thread::spawn(move || {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowThreadProcessId,
        };
        let own_pid = std::process::id();
        let mut last: Option<bool> = None;
        loop {
            let focused = unsafe {
                let hwnd = GetForegroundWindow();
                if hwnd.is_null() {
                    false
                } else {
                    let mut pid: u32 = 0;
                    GetWindowThreadProcessId(hwnd, &mut pid);
                    pid == own_pid
                }
            };
            if last != Some(focused) {
                last = Some(focused);
                let _ = app.emit("app://focused", focused);
            }
            std::thread::sleep(std::time::Duration::from_millis(1000));
        }
    });

    // Non-Windows keeps the JS-side Tauri focus events only. Revisit if
    // Linux/macOS report the same background-CPU behavior as WebView2.
    #[cfg(not(windows))]
    let _ = app;
}
