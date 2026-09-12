#[cfg(target_os = "android")]
mod android;
#[cfg(target_os = "android")]
mod dns_policy;
#[cfg(target_os = "android")]
mod network_context;

#[cfg(target_os = "android")]
#[tauri::mobile_entry_point]
pub fn run() {
    android::run_inner();
}

#[cfg(not(target_os = "android"))]
pub fn run() {}
