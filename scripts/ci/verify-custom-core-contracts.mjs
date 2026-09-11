import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const readJson = (relative) => JSON.parse(read(relative));

function requireContract(condition, message) {
  if (!condition) throw new Error(`[contracts] ${message}`);
}

const pkg = readJson("package.json");
const tauri = readJson("src-tauri/tauri.conf.json");
const runtime = readJson("scripts/runtime-versions.json");
const custom = readJson("scripts/ci/custom-core-pin.json");

requireContract(pkg.version === "1.0.0", `package version drifted to ${pkg.version}`);
requireContract(tauri.version === "1.0.0", `Tauri product version drifted to ${tauri.version}`);
requireContract(custom.repository === "Nishef1/Aether", `unexpected custom core repository ${custom.repository}`);
requireContract(custom.version === "1.9.0", `custom core version drifted to ${custom.version}`);
requireContract(runtime.aether?.version === `v${custom.version}`, "custom core version no longer matches the official runtime baseline");
requireContract(/^[0-9a-f]{40}$/.test(custom.commit ?? ""), "custom core pin is not a full commit SHA");

const nativeProfile = read("src/lib/nativeProfile.ts");
for (const mode of ["automatic", "current", "native-minimal", "compatibility", "experimental"]) {
  requireContract(nativeProfile.includes(`\"${mode}\"`), `native TLS bridge lost ${mode}`);
}
requireContract(nativeProfile.includes("decodeNativeConnectionProfile"), "native profile decoder is missing");
requireContract(nativeProfile.includes("profileForNativeInvoke"), "native profile encoder is missing");
requireContract(nativeProfile.includes("@profile="), "Android TLS bridge marker changed without a migration");

const connectionStore = read("src/state/connectionStore.ts");
requireContract(connectionStore.includes('from "@/lib/nativeProfile"'), "manual connect bypasses the shared native profile bridge");
requireContract(connectionStore.includes("decodeNativeConnectionProfile(profile)"), "persisted Android profiles bypass the shared decoder");
requireContract(connectionStore.includes("profileForNativeInvoke(profile)"), "manual connect bypasses the shared encoder");
requireContract(!connectionStore.includes('const TLS_GROUPS_BRIDGE_PREFIX = "@profile="'), "connection store reintroduced a duplicate TLS bridge marker");
requireContract(!connectionStore.includes("function decodeAndroidTlsBridge"), "connection store reintroduced a duplicate native decoder");

const autoConnect = read("src/lib/autoConnect.ts");
requireContract(autoConnect.includes("profileForNativeInvoke"), "Automatic policy bypasses the shared native profile bridge");
requireContract(autoConnect.includes("profileForNativeInvoke(profile)"), "Automatic candidate launch no longer encodes the native profile");
requireContract(autoConnect.includes("refreshPathNetworkContext"), "Automatic policy can rank stale cross-network history");
for (const reason of [
  "h3-unavailable",
  "tcp-unreachable",
  "tls-blocked",
  "h2-rejected",
  "dataplane-failed",
  "upload-limited",
  "identity-leak",
]) {
  requireContract(autoConnect.includes(`\"${reason}\"`), `Automatic policy lost failure reason ${reason}`);
}
requireContract(autoConnect.includes("probe_connection_acceptance"), "desktop Automatic policy no longer verifies post-connect acceptance");
requireContract(autoConnect.includes("reprioritizeRemainingCandidates"), "Automatic policy lost failure-driven fallback ordering");
requireContract(autoConnect.includes('invoke("disconnect_for_recovery")'), "Automatic fallback can release the full-device kill switch");
requireContract(!autoConnect.includes('isAndroid ? "disconnect"'), "Android Automatic fallback regressed to a full disconnect");
requireContract(autoConnect.includes("function attemptIsCurrent(epoch: number, attemptId: number)"), "Automatic policy lost its shared stale-attempt guard");
requireContract(autoConnect.includes("epoch === automationEpoch && useConnectionStore.getState().attemptId === attemptId"), "Automatic policy no longer validates epoch and attempt identity together");
requireContract(autoConnect.includes("if (!attemptIsCurrent(epoch, attemptId)) return null"), "native status reconciliation can overwrite a newer attempt");
requireContract(autoConnect.includes("recordPathAcceptanceFailure(attemptId, failureReason)"), "Automatic acceptance evidence can be attributed to the wrong attempt");

const telemetryStore = read("src/state/telemetryStore.ts");
requireContract(telemetryStore.includes("profileForNativeInvoke(rerollProfile)"), "privacy reroll bypasses the shared native profile bridge");

const pathStore = read("src/state/pathStore.ts");
requireContract(pathStore.includes("aether.path-intelligence.v2"), "Path Intelligence lost network-scoped storage");
requireContract(pathStore.includes('invoke<string | null>("get_network_context")'), "Path Intelligence no longer resolves the active underlay");
requireContract(pathStore.includes("NETWORK_SCOPE_POLL_MS"), "Path Intelligence no longer verifies a long-lived session's underlay scope");
requireContract(pathStore.includes('networkInformation?.addEventListener("change"'), "Path Intelligence lost browser network-change hints");
requireContract(pathStore.includes("telemetryFreshForNetwork"), "stale pre-transition telemetry can become evidence for a new underlay");
requireContract(pathStore.includes("networkChangedAtMs = Date.now()"), "Path Intelligence does not invalidate session evidence on underlay change");
requireContract(pathStore.includes("uploadLimited: path.uploadLimited === true"), "persisted path history no longer migrates upload evidence safely");
requireContract(pathStore.includes("uploadLimited: telemetry.upload_limited ?? false"), "Path Intelligence no longer records native upload evidence");

const pathIntelligence = read("src/lib/pathIntelligence.ts");
for (const marker of ["ech:n/a", "tls:n/a", "groups:n/a"]) {
  requireContract(pathIntelligence.includes(marker), `non-MASQUE Path IDs lost ${marker}`);
}
requireContract(pathIntelligence.includes("masqueTlsKeys"), "TLS identity is no longer transport-scoped in Path Intelligence");
requireContract(pathIntelligence.includes("uploadPenalty"), "upload-limited paths no longer receive a historical score penalty");

const desktopNetwork = read("src-tauri/src/network_context.rs");
requireContract(desktopNetwork.includes("AETHER_NETWORK_KEY"), "desktop no longer scopes Core history to the underlay");
requireContract(desktopNetwork.includes("sync_process_environment"), "desktop Core network scope is not synchronized before launch");

const desktopAcceptance = read("src-tauri/src/connection_acceptance.rs");
for (const marker of ["api4.ipify.org", "api6.ipify.org", "checkip.amazonaws.com"]) {
  requireContract(desktopAcceptance.includes(marker), `desktop egress identity baseline lost ${marker}`);
}
requireContract(desktopAcceptance.includes("LeakDetected"), "desktop exact-IP identity leak classification is missing");
requireContract(desktopAcceptance.includes("QUICK_UPLOAD_BYTES"), "desktop quick upstream acceptance probe is missing");

const commands = read("src-tauri/src/commands.rs");
requireContract(commands.includes("capture_underlay_baseline"), "desktop does not capture underlay identity before Aether launch");
requireContract(commands.includes("probe_connection_acceptance"), "desktop acceptance command is not exposed to the frontend");
requireContract(commands.includes("disconnect_for_recovery"), "desktop recovery-only disconnect command is missing");
requireContract(commands.includes("runtime.disconnect_for_recovery"), "desktop recovery command no longer preserves the system tunnel");

const desktopEngine = read("src-tauri/src/engine/mod.rs");
requireContract(desktopEngine.includes("let had_active_tunnel = self.system_tunnel.is_active()"), "desktop launch failures can no longer distinguish protected recovery from initial startup");
requireContract(desktopEngine.includes("self.system_tunnel.suspend_attempt_for_recovery(&app)"), "desktop immediate launch failure can release an active kill switch");
requireContract(desktopEngine.includes("hold_for_transport_loss"), "desktop transport loss no longer keeps the full-device route fail-closed");

const desktopTunnel = read("src-tauri/src/system_tunnel/sing_box/config.rs");
requireContract(desktopTunnel.includes("strict_route: true"), "desktop sing-box TUN lost strict routing");
requireContract(desktopTunnel.includes('final_: "proxy"'), "desktop full-device route can bypass the proxy by default");
requireContract(desktopTunnel.includes('action: "hijack-dns"'), "desktop TUN lost DNS hijacking");

const mobileBridge = read("src-tauri/plugins/aether-vpn/src/lib.rs");
for (const field of ["capacity_probe_complete", "download_kbps", "upload_kbps", "upload_limited"]) {
  requireContract(mobileBridge.includes(field), `Android telemetry bridge lost ${field}`);
}
requireContract(mobileBridge.includes("stop_for_recovery"), "Android Rust plugin lost the recovery stop bridge");
requireContract(mobileBridge.includes('run_mobile_plugin("stopForRecovery"'), "Android Rust plugin no longer calls the Kotlin recovery command");
requireContract(mobileBridge.includes("pub struct DiagnosticsExport"), "Android diagnostics result contract is missing");
requireContract(mobileBridge.includes("pub fn export_diagnostics"), "Android Rust plugin lost diagnostics export");
requireContract(mobileBridge.includes('run_mobile_plugin("exportDiagnostics"'), "Android Rust plugin no longer calls the Kotlin diagnostics command");

const mobileRuntime = read("src-tauri/src/android.rs");
requireContract(mobileRuntime.includes("get_network_context"), "Android does not expose network context to Path Intelligence");
for (const field of ["capacity_probe_complete", "download_kbps", "upload_kbps", "upload_limited"]) {
  requireContract(mobileRuntime.includes(`\"${field}\"`), `Android runtime no longer forwards ${field}`);
}
requireContract(mobileRuntime.includes("async fn disconnect_for_recovery"), "Android Tauri runtime lost recovery-only disconnect");
requireContract(mobileRuntime.includes("stop_for_recovery()"), "Android Tauri recovery command bypasses the native recovery bridge");
requireContract(mobileRuntime.includes("disconnect_for_recovery,"), "Android recovery command is not registered with Tauri");
requireContract(mobileRuntime.includes("fn export_android_diagnostics"), "Android Tauri runtime lost diagnostics export");
requireContract(mobileRuntime.includes(".export_diagnostics()"), "Android diagnostics export bypasses the mobile plugin");
requireContract(mobileRuntime.includes("export_android_diagnostics,"), "Android diagnostics export is not registered with Tauri");

const mobileNative = read("src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt");
requireContract(mobileNative.includes("fun stopForRecovery"), "Android Kotlin plugin lost the protected recovery command");
requireContract(mobileNative.includes("ACTION_RECOVER"), "Android VPN service lost its recovery action");
requireContract(mobileNative.includes("detachCoreResources()"), "Android recovery no longer separates transport cleanup from VPN cleanup");
requireContract(mobileNative.includes("Reusing protected Android VPN interface during transport recovery"), "Android recovery no longer reuses the installed VPN interface");
requireContract(mobileNative.includes('.addRoute("0.0.0.0", 0)'), "Android full-device VPN no longer captures IPv4 default traffic");
requireContract(mobileNative.includes('.addRoute("::", 0)'), "Android full-device VPN no longer captures IPv6 default traffic");
requireContract(!mobileNative.includes("allowBypass()"), "Android VPN allows applications to bypass full-device protection");
requireContract(mobileNative.includes("fun exportDiagnostics"), "Android Kotlin plugin lost diagnostics export");
requireContract(mobileNative.includes("AndroidDiagnosticsExporter.export(activity)"), "Android diagnostics command no longer invokes the bounded exporter");
requireContract(mobileNative.includes('recordFailure("session"'), "Android active-session failures are absent from diagnostics");
requireContract(mobileNative.includes('recordFailure("service-start"'), "Android service-start failures are absent from diagnostics");

const mobileDiagnosticsRuntime = read("src-tauri/plugins/aether-vpn/android/src/main/java/AndroidVpnRuntime.kt");
requireContract(mobileDiagnosticsRuntime.includes("MAX_INTERNAL_TAIL_LINES = 160"), "Android diagnostics log tail is no longer bounded");
requireContract(mobileDiagnosticsRuntime.includes("MAX_FAILURE_CHARS = 4 * 1024"), "Android crash summary is no longer bounded");
requireContract(mobileDiagnosticsRuntime.includes("Thread.setDefaultUncaughtExceptionHandler"), "Android crash summary no longer captures uncaught process failures");
requireContract(mobileDiagnosticsRuntime.includes("getSharedPreferences(FAILURE_PREFS"), "Android crash summary no longer survives process restart");
requireContract(mobileDiagnosticsRuntime.includes('recordFailure("safety"'), "Android safety failures no longer reach diagnostics");

const mobileDiagnosticsInitializer = read("src-tauri/plugins/aether-vpn/android/src/main/java/AetherDiagnosticsInitializer.kt");
requireContract(mobileDiagnosticsInitializer.includes("AndroidVpnRuntime::initialize"), "Android crash diagnostics are not initialized at process startup");
requireContract(mobileDiagnosticsInitializer.includes("ContentProvider"), "Android early diagnostics initializer lost its process-start hook");

const mobileDiagnosticsExporter = read("src-tauri/plugins/aether-vpn/android/src/main/java/AndroidDiagnosticsExporter.kt");
for (const marker of [
  "MediaStore.Downloads.EXTERNAL_CONTENT_URI",
  "Environment.DIRECTORY_DOWNLOADS",
  '"runtime.json"',
  '"network-capabilities.json"',
  '"runtime.log"',
  "connectivity.allNetworks",
  "lastFailureSnapshot",
  "getHistoricalProcessExitReasons",
  "ApplicationExitInfo.REASON_CRASH_NATIVE",
  '"historical_process_exits"',
  "exits.take(5)",
]) {
  requireContract(mobileDiagnosticsExporter.includes(marker), `Android diagnostics exporter lost ${marker}`);
}
for (const secret of ["AETHER_ACCESS_TOKEN", "AETHER_ACCESS_CLIENT_SECRET", "AETHER_UPSTREAM"]) {
  requireContract(!mobileDiagnosticsExporter.includes(secret), `Android diagnostics exporter references secret-bearing ${secret}`);
}

const mobileManifest = read("src-tauri/plugins/aether-vpn/android/src/main/AndroidManifest.xml");
requireContract(mobileManifest.includes("android.permission.ACCESS_NETWORK_STATE"), "Android diagnostics cannot inspect network capabilities");
requireContract(mobileManifest.includes("AetherDiagnosticsInitializer"), "Android crash diagnostics initializer is not registered");
requireContract(!mobileManifest.includes("WRITE_EXTERNAL_STORAGE"), "Android diagnostics reintroduced broad legacy storage permission");
requireContract(!mobileManifest.includes("MANAGE_EXTERNAL_STORAGE"), "Android diagnostics requests broad all-files access");

const advancedPanel = read("src/components/AdvancedPanel.tsx");
requireContract(advancedPanel.includes('invoke<AndroidDiagnosticsExport>("export_android_diagnostics")'), "Android diagnostics UI no longer invokes the native exporter");
requireContract(advancedPanel.includes("Export ZIP"), "Android diagnostics export control disappeared");
requireContract(advancedPanel.includes("Downloads/Aether"), "Android diagnostics UI no longer tells the user where the bundle is saved");

const coreHistory = read("vendor/aether/aether/src/path_history.rs");
requireContract(coreHistory.includes("detected_network_key"), "custom Core lost underlay detection fallback");
requireContract(coreHistory.includes("fn choose_network_key"), "custom Core no longer separates live detection from launch hints");
requireContract(coreHistory.includes("detected\n        .or(configured)"), "stale launch-time network hints can override live route detection");
requireContract(coreHistory.includes("live_detection_wins_over_stale_launch_hint"), "custom Core lost regression coverage for mid-process network changes");
requireContract(coreHistory.includes("unknown-process:"), "unknown Core underlays can share persistent history again");
const coreLastConn = read("vendor/aether/aether/src/lastconn.rs");
requireContract(coreLastConn.includes("pub network_key: String"), "quick reconnect cache is no longer network-scoped");
requireContract(coreLastConn.includes("diversify_ranked"), "quick reconnect lost rescue failure-domain diversity");
const coreSocks = read("vendor/aether/aether/src/socks.rs");
requireContract(coreSocks.includes("CMD_UDP_ASSOCIATE"), "custom Core lost SOCKS5 UDP ASSOCIATE capability");
requireContract(coreSocks.includes("handle_udp_associate"), "custom Core no longer serves SOCKS5 UDP traffic");

const coreFragment = read("vendor/aether/aether/src/fragment.rs");
requireContract(coreFragment.includes("PATTERNIHA_TLS_FIRST_PAYLOAD: usize = 104"), "compatibility mask lost the current 104-byte TLS record stage");
requireContract(coreFragment.includes("PATTERNIHA_TCP_FIRST_WRITE: usize = 114"), "compatibility mask lost the current 114-byte TCP first write");
requireContract(coreFragment.includes("PATTERNIHA_TCP_MAX_SPLITS: usize = 11"), "compatibility mask lost the bounded eleven-write stage");
requireContract(coreFragment.includes("append_tls_record(&mut out, buf, &[])"), "compatibility mask no longer preserves zero-length tlshello semantics");
requireContract(coreFragment.includes("PatternPendingWrite"), "compatibility mask lost backpressure-safe transformed write state");

const workflow = read(".github/workflows/build.yml");
requireContract(workflow.includes("npm run verify:contracts"), "GitHub Actions does not enforce integration contracts");
const arch = read("packaging/arch/PKGBUILD");
requireContract(arch.includes("npm run verify:contracts"), "Arch packaging bypasses integration contracts");
requireContract(arch.includes("'!lto'"), "Arch makepkg can reintroduce incompatible native BoringSSL LTO");

requireContract(pkg.scripts?.["prepare:aether"] === "node scripts/prepare-custom-aether.mjs", "default desktop core preparation is not the pinned custom core");
requireContract(pkg.scripts?.["prepare:android-native"] === "node scripts/prepare-android-native.mjs --custom", "default Android core preparation is not the pinned custom core");

console.log(`[contracts] Aether-GUI ${pkg.version} custom core integration verified at ${custom.commit.slice(0, 12)}`);
