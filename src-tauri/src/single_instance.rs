#[cfg(windows)]
use std::sync::atomic::{AtomicUsize, Ordering};

#[cfg(windows)]
const INSTANCE_MUTEX_NAME: &str = "Local\\com.cluvexstudio.aethergui.instance";
#[cfg(windows)]
const WINDOW_TITLE: &str = "Aether-GUI";

// Keep the mutex handle alive for the process lifetime, while still allowing a
// controlled handoff immediately before UAC elevation or an app relaunch.
#[cfg(windows)]
static INSTANCE_MUTEX_HANDLE: AtomicUsize = AtomicUsize::new(0);

#[cfg(windows)]
fn wide_null(value: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// Returns true only for the first GUI process in the current Windows session.
/// A native named mutex is used instead of a PID file so abnormal termination
/// cannot leave a stale lock that prevents a future launch.
#[cfg(windows)]
pub fn acquire() -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS};
    use windows_sys::Win32::System::Threading::CreateMutexW;

    if INSTANCE_MUTEX_HANDLE.load(Ordering::Acquire) != 0 {
        return true;
    }

    let name = wide_null(INSTANCE_MUTEX_NAME);
    let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
    if handle.is_null() {
        // Do not make the application unusable if the OS refuses mutex creation;
        // the existing port/process ownership checks remain a secondary guard.
        return true;
    }

    if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
        unsafe {
            CloseHandle(handle);
        }
        return false;
    }

    INSTANCE_MUTEX_HANDLE.store(handle as usize, Ordering::Release);
    true
}

/// Release ownership immediately before creating the replacement process. The
/// caller must reacquire when the handoff is cancelled or fails.
#[cfg(windows)]
pub fn release_for_handoff() {
    use windows_sys::Win32::Foundation::CloseHandle;

    let handle = INSTANCE_MUTEX_HANDLE.swap(0, Ordering::AcqRel);
    if handle != 0 {
        unsafe {
            CloseHandle(handle as _);
        }
    }
}

/// Best-effort activation for a second-launch attempt. This covers the common
/// case where the first instance is minimized or hidden by close-to-tray.
#[cfg(windows)]
pub fn activate_existing_window() {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        FindWindowW, SetForegroundWindow, ShowWindow, SW_RESTORE, SW_SHOW,
    };

    let title = wide_null(WINDOW_TITLE);
    let window = unsafe { FindWindowW(std::ptr::null(), title.as_ptr()) };
    if window.is_null() {
        return;
    }

    unsafe {
        ShowWindow(window, SW_SHOW);
        ShowWindow(window, SW_RESTORE);
        SetForegroundWindow(window);
    }
}

#[cfg(not(windows))]
pub fn acquire() -> bool {
    true
}

#[cfg(not(windows))]
pub fn release_for_handoff() {}

#[cfg(not(windows))]
pub fn activate_existing_window() {}

#[cfg(test)]
mod tests {
    #[test]
    fn instance_identity_is_stable() {
        #[cfg(windows)]
        {
            assert!(super::INSTANCE_MUTEX_NAME.starts_with("Local\\"));
            assert_eq!(super::WINDOW_TITLE, "Aether-GUI");
        }
    }
}
