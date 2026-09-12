import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function requireContract(condition, message) {
  if (!condition) throw new Error(`[dns-contracts] ${message}`);
}

const dnsControl = read("src/components/DnsProtectionControl.tsx");
requireContract(dnsControl.includes("94.140.14.14,94.140.15.15"), "AdGuard filtering DNS pair changed or disappeared");
requireContract(dnsControl.includes('setField("dns"'), "DNS protection no longer writes the connection profile");

const quickCard = read("src/components/QuickConnectionCard.tsx");
requireContract(quickCard.includes("DnsProtectionControl"), "DNS protection disappeared from quick connection controls");

const frontendStore = read("src/state/connectionStore.ts");
for (const marker of ['scan_mode: "turbo"', "quick_reconnect: true", "masque_http2: true"]) {
  requireContract(frontendStore.includes(marker), `fresh frontend profile lost ${marker}`);
}
requireContract(frontendStore.includes("androidStartupBudgetSecs(profile)"), "Android UI watchdog drifted from transport-aware policy");

const desktopDns = read("src-tauri/src/dns_policy.rs");
for (const marker of ["parse_resolvers", "effective_resolvers", "profile_resolvers", "DEFAULT_DNS_V4"]) {
  requireContract(desktopDns.includes(marker), `shared DNS policy lost ${marker}`);
}
requireContract(desktopDns.includes("94.140.14.14,94.140.15.15"), "DNS policy regression test lost filtering resolver coverage");

const engine = read("src-tauri/src/engine/mod.rs");
requireContract(engine.includes("dns_policy::profile_resolvers"), "engine no longer captures DNS from the exact launch profile");
requireContract(engine.includes("dns_servers: dns_servers.clone()"), "active resolver set no longer reaches TunnelContext");

const systemTunnel = read("src-tauri/src/system_tunnel/mod.rs");
requireContract(systemTunnel.includes("pub dns_servers: Vec<SocketAddr>"), "system tunnel context lost DNS resolver identity");

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
for (const marker of ['scan_mode: "turbo".into()', "quick_reconnect: true", "masque_http2: true"]) {
  requireContract(androidRuntime.includes(marker), `fresh Android profile lost ${marker}`);
}
requireContract(androidRuntime.includes("crate::dns_policy::parse_resolvers"), "Android DNS validation bypasses the shared parser");
requireContract(androidRuntime.includes("crate::dns_policy::effective_resolvers"), "Android VpnService DNS can drift from Core resolver policy");

const androidLib = read("src-tauri/src/lib.rs");
requireContract(androidLib.includes("mod dns_policy;"), "Android build no longer includes shared DNS policy");

console.log("[dns-contracts] DNS protection and Iran-first defaults are aligned");
