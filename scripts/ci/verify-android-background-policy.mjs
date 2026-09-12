import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function requireContract(condition, message) {
  if (!condition) throw new Error(`[android-background-contracts] ${message}`);
}

const manifest = read("src-tauri/plugins/aether-vpn/android/src/main/AndroidManifest.xml");
for (const marker of [
  'android.permission.WAKE_LOCK',
  'android.permission.FOREGROUND_SERVICE',
  'android:foregroundServiceType="specialUse"',
  'android:stopWithTask="false"',
]) {
  requireContract(manifest.includes(marker), `Android VPN background contract lost: ${marker}`);
}

const initializer = read(
  "src-tauri/plugins/aether-vpn/android/src/main/java/AetherDiagnosticsInitializer.kt",
);
requireContract(
  initializer.includes("AndroidScreenOffKeepAlive.initialize(appContext)"),
  "screen-off keepalive is no longer installed at process startup",
);

const keepAlive = read(
  "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidScreenOffKeepAlive.kt",
);
for (const marker of [
  "PowerManager.PARTIAL_WAKE_LOCK",
  "!powerManager.isInteractive",
  "vpnLifecycleNeedsCpu()",
  '"Tunneling"',
  '"Connected"',
  "ContextCompat.RECEIVER_NOT_EXPORTED",
  "setReferenceCounted(false)",
  "STATE_RECHECK_MS",
  "monitorRunning",
  "ensureScreenOffMonitor()",
  "releaseLocked(current)",
]) {
  requireContract(keepAlive.includes(marker), `screen-off liveness policy drifted: ${marker}`);
}
requireContract(
  !keepAlive.includes("FULL_WAKE_LOCK") && !keepAlive.includes("SCREEN_BRIGHT_WAKE_LOCK"),
  "VPN background liveness must never keep the display awake",
);
requireContract(
  !keepAlive.includes("REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"),
  "Aether must not silently request a broad battery-optimization exemption",
);

const notifications = read(
  "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidVpnNotifications.kt",
);
requireContract(
  notifications.includes("service.startForeground("),
  "VpnService must remain a user-visible foreground service",
);
requireContract(
  notifications.includes(".setOngoing(true)"),
  "active VPN foreground notification lost its ongoing state",
);

// The Android Tauri surface must keep both tunnel-mode commands registered.
// A function that still exists in Rust but drops out of generate_handler is a
// silent IPC regression: the UI compiles, but changing the system tunnel stops
// working at runtime.
const androidRuntime = read("src-tauri/src/android.rs");
for (const command of ["get_system_tunnel", "set_system_tunnel"]) {
  const references = androidRuntime.match(new RegExp(`\\b${command}\\b`, "g"))?.length ?? 0;
  requireContract(references >= 2, `${command} exists but is no longer registered in invoke_handler`);
}
requireContract(
  androidRuntime.includes('if current.state != "Idle"'),
  "Android tunnel mode can change while a retained fail-closed TUN may still be active",
);

console.log(
  "[android-background-contracts] foreground VPN, tunnel IPC and screen-off dataplane liveness are aligned",
);
