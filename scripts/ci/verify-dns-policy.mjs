import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function requireContract(condition, message) {
  if (!condition) throw new Error(`[dns-contracts] ${message}`);
}

const dnsControl = read("src/components/DnsProtectionControl.tsx");
for (const marker of [
  "94.140.14.14,94.140.15.15",
  "2a10:50c0::ad1:ff",
  "2606:4700:4700::1111",
  "defaultCustomDns(ipVersion)",
  'setField("dns"',
]) {
  requireContract(dnsControl.includes(marker), `DNS control drifted: ${marker}`);
}

const quickCard = read("src/components/QuickConnectionCard.tsx");
requireContract(quickCard.includes("DnsProtectionControl"), "DNS protection disappeared from quick connection controls");

const frontendStore = read("src/state/connectionStore.ts");
for (const marker of ['scan_mode: "turbo"', "quick_reconnect: true", "masque_http2: true"]) {
  requireContract(frontendStore.includes(marker), `fresh frontend profile lost ${marker}`);
}
requireContract(frontendStore.includes("androidStartupBudgetSecs(profile)"), "Android UI watchdog drifted from transport-aware policy");

const desktopDns = read("src-tauri/src/dns_policy.rs");
for (const marker of [
  "parse_resolvers",
  "effective_resolvers_for_ip_version",
  "profile_resolvers",
  "DEFAULT_DNS_V4",
  "DEFAULT_DNS_V6",
  'ip_version == "both"',
]) {
  requireContract(desktopDns.includes(marker), `shared DNS policy lost ${marker}`);
}
requireContract(desktopDns.includes("94.140.14.14,2a10:50c0::ad1:ff"), "DNS policy regression test lost dual-family filtering coverage");

const engine = read("src-tauri/src/engine/mod.rs");
requireContract(engine.includes("dns_policy::profile_resolvers"), "engine no longer captures DNS from the exact launch profile");
requireContract(engine.includes("dns_servers: dns_servers.clone()"), "active resolver set no longer reaches TunnelContext");
requireContract(
  engine.includes("if let Err(error) = runtime.system_tunnel.refresh_active_context(context)"),
  "desktop recovery can ignore stale TUN DNS/SOCKS settings",
);

const systemTunnel = read("src-tauri/src/system_tunnel/mod.rs");
for (const marker of [
  "pub dns_servers: Vec<SocketAddr>",
  "pub fn refresh_active_context(&self, context: TunnelContext) -> Result<(), RuntimeError>",
  "active.dns_servers != context.dns_servers",
  "active.upstream_socks_addr != context.upstream_socks_addr",
  "Disconnect explicitly before applying those changes",
  "retained_tunnel_rejects_sock_or_dns_reconfiguration",
]) {
  requireContract(systemTunnel.includes(marker), `desktop fail-closed DNS contract drifted: ${marker}`);
}

const singboxConfig = read("src-tauri/src/system_tunnel/sing_box/config.rs");
requireContract(singboxConfig.includes("dns_servers: &[SocketAddr]"), "sing-box config no longer consumes active resolvers");
requireContract(singboxConfig.includes('detour: "proxy".into()'), "desktop DNS can bypass the protected proxy path");
requireContract(singboxConfig.includes("RouteRule::hijack_dns()"), "desktop TUN lost DNS hijacking");
requireContract(singboxConfig.includes("strict_route: true"), "desktop DNS leak protection lost strict routing");

const singboxRuntime = read("src-tauri/src/system_tunnel/sing_box/mod.rs");
requireContract(singboxRuntime.includes("&context.dns_servers"), "sing-box launch ignores TunnelContext DNS");

const singboxStatus = read("src-tauri/src/system_tunnel/sing_box/status.rs");
requireContract(singboxStatus.includes("socks5h://"), "Core DNS path is no longer independently health-checked");

const desktopProfile = read("src-tauri/src/aether/profiles.rs");
for (const marker of ["scan_mode: ScanMode::Turbo", "quick_reconnect: true", "masque_http2: true"]) {
  requireContract(desktopProfile.includes(marker), `fresh desktop profile lost ${marker}`);
}
requireContract(desktopProfile.includes("old_profile_json_gets_new_optional_defaults_without_rewriting_explicit_choices"), "legacy profile regression coverage disappeared");

const androidRuntime = read("src-tauri/src/android.rs");
for (const marker of [
  'scan_mode: "turbo".into()',
  "quick_reconnect: true",
  "masque_http2: true",
  "crate::dns_policy::parse_resolvers",
  "crate::dns_policy::effective_resolvers_for_ip_version",
  "fn normalize_runtime_dns",
  "Android system DNS resolvers must use port 53",
  "DNS resolver family must match the selected Android IP family",
  'if current.state != "Idle"',
]) {
  requireContract(androidRuntime.includes(marker), `Android DNS/runtime contract drifted: ${marker}`);
}

const androidBridge = read(
  "src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt",
);
for (const marker of [
  "val dnsServers: List<String>",
  "private fun systemDnsServers(profile: RuntimeProfile): List<String>",
  "dnsServers.forEach { server -> builder.addDnsServer(server) }",
  "tunnelDnsServers = tunnel.dnsServers",
  "retained.dnsServers != requestedDns",
  "retained.mtu != profile.mtu",
  "retained.socksAddress != profile.bindAddress",
  "Disconnect explicitly before applying those changes",
]) {
  requireContract(androidBridge.includes(marker), `Android VpnService DNS parity drifted: ${marker}`);
}

const androidLib = read("src-tauri/src/lib.rs");
requireContract(androidLib.includes("mod dns_policy;"), "Android build no longer includes shared DNS policy");

console.log("[dns-contracts] DNS family, TUN parity and fail-closed recovery invariants are aligned");
