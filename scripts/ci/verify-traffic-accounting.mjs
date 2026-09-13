import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function requireContract(condition, message) {
  if (!condition) throw new Error(`[traffic-accounting] ${message}`);
}

const traffic = read("src-tauri/src/traffic.rs");
for (const marker of [
  "GetIfTable2",
  "String::from_utf16_lossy(&row.Alias[..length]) == interface_name",
  'std::fs::read_to_string("/proc/net/dev")',
  "interface.trim() != interface_name",
  '.args(["-ibn", "-I", interface_name])',
]) {
  requireContract(
    traffic.includes(marker),
    `desktop tunnel counters must stay bound to the requested TUN interface: ${marker}`,
  );
}

const singBoxConfig = read("src-tauri/src/system_tunnel/sing_box/config.rs");
requireContract(
  singBoxConfig.includes('pub const TUN_INTERFACE_NAME: &str = "aether-tun";'),
  "desktop traffic accounting must keep a stable dedicated system-tunnel interface",
);

const telemetry = read("src-tauri/src/telemetry.rs");
for (const marker of [
  "last_raw_traffic: raw_traffic",
  "delayed_interface_start_establishes_a_baseline_without_backfilling_old_bytes",
  "counter_reset_establishes_a_new_baseline_without_a_spike",
  "normal_counter_growth_is_reported_as_session_delta",
]) {
  requireContract(
    telemetry.includes(marker),
    `desktop session-relative traffic accounting contract drifted: ${marker}`,
  );
}

const androidRuntime = read(
  "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidVpnRuntime.kt",
);
for (const marker of [
  "class SessionTrafficCounter",
  "trafficCounter.reset()",
  "trafficCounter::sample",
  "TProxyGetStats()",
  "receivedBytes = stats[3].coerceAtLeast(0L)",
  "sentBytes = stats[1].coerceAtLeast(0L)",
]) {
  requireContract(
    androidRuntime.includes(marker),
    `Android native VPN traffic accounting contract drifted: ${marker}`,
  );
}

const androidService = read(
  "src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt",
);
requireContract(
  androidService.includes("AndroidVpnRuntime.resetTelemetry()") &&
    androidService.includes('"Device traffic is routed through Aether"'),
  "Android must reset session telemetry on connection start while keeping device-wide tunnel semantics",
);

const androidTests = read(
  "src-tauri/plugins/aether-vpn/android/src/test/java/SessionTrafficCounterTest.kt",
);
for (const marker of [
  "firstSampleOnlyEstablishesSessionBaseline",
  "reportsOnlyGrowthAfterTheBaseline",
  "counterResetDoesNotBackfillOldTunnelBytes",
  "resetStartsANewSessionWithoutCarryingPriorBytes",
]) {
  requireContract(androidTests.includes(marker), `Android traffic regression test missing: ${marker}`);
}

const status = read("src/components/ConnectionStatusLine.tsx");
for (const marker of [
  "Device traffic through VPN",
  "Includes apps + background services · not Aether-only usage",
  "All apps and background system services routed through the VPN in this connection",
]) {
  requireContract(status.includes(marker), `traffic scope must stay explicit in the UI: ${marker}`);
}
requireContract(
  !status.includes("Σ {formatBytes(totalBytes)}"),
  "the redundant aggregate byte total should not return to the primary status line",
);

console.log(
  "[traffic-accounting] Windows/Linux/macOS TUN counters, Android session deltas, reset behavior and explicit device-wide UI semantics verified",
);
