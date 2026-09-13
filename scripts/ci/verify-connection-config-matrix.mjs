import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function requireContract(condition, message) {
  if (!condition) throw new Error(`[connection-config] ${message}`);
}

function requireAll(source, markers, label) {
  for (const marker of markers) {
    requireContract(source.includes(marker), `${label} lost ${marker}`);
  }
}

const desktop = read("src-tauri/src/aether/profiles.rs");
const desktopPty = read("src-tauri/src/aether/pty.rs");
const androidRuntime = read("src-tauri/src/android.rs");
const androidNative = read(
  "src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt",
);
const androidBridge = read("src/lib/nativeProfile.ts");
const singBox = read("src-tauri/src/system_tunnel/sing_box/config.rs");
const gate = read("src-tauri/tests/connection_config_gate.rs");

// Desktop transport / scan / family / reconnect matrix.
requireAll(desktop, [
  'Protocol::Auto | Protocol::Masque => args.push("--masque".into())',
  'Protocol::Wireguard => args.push("--wg".into())',
  'Protocol::Gool => args.push("--gool".into())',
  'ScanMode::Turbo => "--turbo".into()',
  'ScanMode::Balanced => "--balanced".into()',
  'ScanMode::Thorough => "--thorough".into()',
  'ScanMode::Stealth => "--stealth".into()',
  'ScanMode::Ironclad => "--ironclad".into()',
  'IpVersion::V4 => "-4".into()',
  'IpVersion::V6 => "-6".into()',
  'IpVersion::Both => "--dual".into()',
  '"--quick-reconnect".into()',
  '"--no-quick-reconnect".into()',
  '"--wiw-scan".into()',
  '"--wiw-outer"',
  '"--wiw-inner"',
  '"--keepalive".into()',
], "desktop profile encoder");

// MASQUE H2/H3, deterministic masks and TLS must reach the core distinctly.
requireAll(desktopPty, [
  '"AETHER_MASQUE_HTTP2"',
  '"AETHER_MASQUE_H2_MASK"',
  'profile.masque_mask.as_env()',
  '"AETHER_TLS_PROFILE"',
  'profile.tls_profile.as_env()',
  '"AETHER_ROUTE_SNIFF"',
  '"AETHER_REPROVISION"',
], "desktop core environment");
requireAll(desktop, [
  'MasqueMask::Legacy => "legacy"',
  'MasqueMask::Clienthello => "clienthello"',
  'MasqueMask::Patterniha => "patterniha-experimental"',
  'TlsProfile::NativeMinimal => "native-minimal"',
  'TlsProfile::Compatibility => "compatibility"',
  'TlsProfile::Experimental => "experimental"',
], "desktop mask/TLS mapping");

// Android must preserve the same transport choices while clearing stale fields
// before they cross into the Kotlin service.
requireAll(androidRuntime, [
  '"wireguard" => {',
  '"gool" => {',
  'self.masque_http2 = false;',
  'self.wiw_scan = false;',
  'self.apply_h2_mask_bridge();',
  'Some("legacy") => self.fragment = true',
  'Some("clienthello") => {',
  'self.fragment_size = "clienthello".into();',
  'Some("patterniha") => {',
  'self.fragment_size = "patterniha".into();',
  'quick_reconnect: profile.quick_reconnect',
], "Android Rust profile bridge");

requireAll(androidNative, [
  '"wireguard" -> "--wg"',
  '"gool" -> "--gool"',
  'else -> "--masque"',
  '"v6" -> "-6"',
  '"both" -> "--dual"',
  'else -> "-4"',
  'if (profile.quickReconnect) "--quick-reconnect" else "--no-quick-reconnect"',
  'if (profile.wiwScan && profile.protocol == "gool") command += "--wiw-scan"',
  'if (profile.masqueHttp2) command += "--h2"',
  'if (profile.fragment && profile.masqueHttp2) {',
  'if (profile.protocol == "wireguard" || profile.protocol == "gool") {',
  '"--keepalive"',
], "Android core command encoder");

// Android TLS intentionally uses the established tls_groups compatibility
// bridge. Do not add a second native profile field unless this migration changes.
requireAll(androidBridge, [
  'const TLS_GROUPS_BRIDGE_PREFIX = "@profile="',
  'tls_groups: `${TLS_GROUPS_BRIDGE_PREFIX}${tlsProfile}',
  'tls_profile: isTlsProfileMode(encodedProfile) ? encodedProfile : "automatic"',
  'enforceDnsFamily(enforceIpFamily(profile))',
], "Android native profile compatibility bridge");

// Full-device sing-box must remain fail-closed and valid on the pinned 1.14
// schema. The real binary check in connection_config_gate.rs is the final gate.
requireAll(singBox, [
  'strict_route: true',
  'final_: "proxy"',
  'action: "hijack-dns"',
  'default_domain_resolver: final_dns',
], "sing-box system tunnel config");
requireContract(
  ![desktop, desktopPty, androidRuntime, androidNative, singBox].some((source) =>
    source.includes("ENABLE_DEPRECATED_MISSING_DOMAIN_RESOLVER"),
  ),
  "deprecated sing-box missing-domain-resolver compatibility switch was reintroduced",
);

requireAll(gate, [
  "transport_argument_matrix_covers_masque_wireguard_and_warp_in_warp",
  "ip_family_and_quick_reconnect_matrix_is_unambiguous",
  "masque_mask_and_tls_profile_matrix_matches_core_contract",
  "system_tunnel_config_matrix_has_explicit_dns_and_fail_closed_routing",
  "pinned_sing_box_accepts_every_generated_system_tunnel_config",
  "AETHER_REQUIRE_SING_BOX_CHECK",
], "pre-build executable configuration gate");

console.log(
  "Connection configuration matrix contract passed: MASQUE H2/H3 + masks/TLS, WireGuard, WARP-in-WARP, IP families, reconnect policy, Android parity and pinned sing-box schema are covered.",
);
