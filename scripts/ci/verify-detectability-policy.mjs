import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function requireContract(condition, message) {
  if (!condition) throw new Error(`[detectability-contracts] ${message}`);
}

const automatic = read("src/lib/automaticPolicy.ts");
requireContract(
  automatic.includes('const DEFAULT_TRANSPORT_ORDER: AutomaticTransport[] = ["h2", "wg", "h3", "gool"]'),
  "automatic fallback order no longer keeps single-hop transports ahead of Warp-in-Warp",
);
requireContract(
  automatic.includes('transport !== baseline && transport !== "gool"'),
  "historical path ranking can promote nested Warp-in-Warp ahead of single-hop fallbacks",
);
requireContract(
  automatic.includes("must never\n  // promote the nested WiW path ahead of a single-hop fallback"),
  "nested-path detectability rationale disappeared from automatic policy",
);

const scanMode = read("src/components/ScanModeToggle.tsx");
requireContract(
  scanMode.includes("Quiet discovery only"),
  "Stealth mode is no longer clearly scoped to pre-connect discovery",
);
requireContract(
  scanMode.includes("does not hide the final VPN exit"),
  "Stealth UI again implies website invisibility",
);

// Live transport liveness must stay activity-aware. Periodic application-level
// probes/junk create avoidable traffic cadence, extra battery cost, and another
// signal for flow classifiers. Initial dataplane verification remains intact.
const wg = read("vendor/aether/aether/src/wireguard.rs");
requireContract(
  wg.includes("wg_health_probe_after(stale_timeout)"),
  "WireGuard health probing is no longer gated by an idle threshold",
);
requireContract(
  wg.includes("if probe_in_flight"),
  "WireGuard can issue repeated dataplane probes in one idle window",
);
requireContract(
  wg.includes('AETHER_WG_KEEPALIVE_JUNK'),
  "WireGuard keepalive junk is no longer explicit opt-in",
);
requireContract(
  wg.includes("configured_keepalive(keepalive)"),
  "Warp-in-Warp can drift to independent hard-coded keepalive cadences",
);

// A failed WiW pair must not be immediately selected again just because the
// rescan happened to hit the same Cloudflare edges first. Cooldown is keyed by
// IP and expanded across all WireGuard ports, then expires normally.
const wgProber = read("vendor/aether/aether/src/wg_prober.rs");
for (const marker of [
  "WIW_LAST_SELECTION",
  "WIW_COOLDOWNS",
  'AETHER_WG_ENDPOINT_COOLDOWN_SECS',
  "previous WARP-in-WARP hop set moved into",
  "add_ip_exclusions",
]) {
  requireContract(wgProber.includes(marker), `WiW failed-hop cooldown regressed: ${marker}`);
}

const h2 = read("vendor/aether/aether/src/masque_h2.rs");
requireContract(
  h2.includes("keepalive_due(&last_activity, keepalive_period)"),
  "MASQUE H2 keepalive reverted to an unconditional periodic cadence",
);
requireContract(
  h2.includes("mark_activity(&last_activity)"),
  "MASQUE H2 no longer resets liveness from real traffic",
);

const h3 = read("vendor/aether/aether/src/quic.rs");
requireContract(
  h3.includes("last_activity.elapsed() >= keepalive_period"),
  "MASQUE H3 keepalive reverted to an unconditional periodic cadence",
);
requireContract(
  h3.includes('AETHER_MASQUE_H3_KEEPALIVE_SECS'),
  "MASQUE H3 lost its bounded idle keepalive policy",
);

const adaptive = read("vendor/aether/aether/src/cli/adaptive.rs");
requireContract(
  adaptive.includes("const DEFAULT_WG_KEEPALIVE_SECS: u16 = 25"),
  "standard idle WireGuard keepalive default drifted from 25 seconds",
);
requireContract(
  adaptive.includes('set_default("AETHER_WG_KEEPALIVE", DEFAULT_WG_KEEPALIVE_SECS)'),
  "standalone WireGuard/WiW can fall back to inconsistent keepalive cadences",
);

// Ironclad proves application traffic inside the selected tunnel. That check
// must not announce the product name to the HTTP probe destination or add a
// product-specific User-Agent that becomes an avoidable exit-side signature.
const ironclad = read("vendor/aether/aether/src/tunnelping.rs");
requireContract(
  ironclad.includes("fn http_probe_request()"),
  "Ironclad HTTP probe no longer has a reviewable minimal request builder",
);
requireContract(
  !ironclad.toLowerCase().includes("aether-ironclad"),
  "Ironclad HTTP probe exposes the Aether product name",
);
requireContract(
  ironclad.includes('assert!(!request.to_ascii_lowercase().contains("user-agent:"))'),
  "Ironclad probe regression test no longer forbids a branded User-Agent",
);

for (const [file, marker] of [
  ["src/state/connectionStore.ts", "keepalive: 25"],
  ["src-tauri/src/aether/profiles.rs", "25"],
  ["src-tauri/src/android.rs", "keepalive: 25"],
]) {
  requireContract(read(file).includes(marker), `${file} drifted from the core keepalive policy`);
}

// The Kotlin bridge has its own deserialization/Intent fallbacks. They must
// match the reachability-first profile too, otherwise a partial restore can
// silently regress to Balanced/H3/no-quick-reconnect/5s WireGuard keepalive.
const androidBridge = read(
  "src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt",
);
for (const marker of [
  'var scanMode: String = "turbo"',
  "var quickReconnect: Boolean = true",
  "var masqueHttp2: Boolean = true",
  "var keepalive: Int = 25",
  'intent.getStringExtra(EXTRA_PROTOCOL) ?: "auto"',
  'intent.getStringExtra(EXTRA_SCAN_MODE) ?: "turbo"',
  "intent.getBooleanExtra(EXTRA_QUICK_RECONNECT, true)",
  "intent.getBooleanExtra(EXTRA_MASQUE_HTTP2, true)",
  "intent.getIntExtra(EXTRA_KEEPALIVE, 25)",
]) {
  requireContract(androidBridge.includes(marker), `Android native fallback drifted: ${marker}`);
}

const threatModel = read("docs/PRIVACY_DETECTABILITY.md");
for (const marker of [
  "DNS leaks and resolver mismatch",
  "WebRTC leaks",
  "Avoidable latency and flow overhead",
  "TCP/IP fingerprint",
  "Browser/device timezone",
  "Hosting-provider / ASN classification",
  "Known proxy/VPN lists and exit enumeration",
]) {
  requireContract(threatModel.includes(marker), `threat model lost section: ${marker}`);
}
requireContract(
  threatModel.includes("Do not add artificial post-connect latency"),
  "anti-detection policy can regress into latency padding",
);
requireContract(
  threatModel.includes('Avoid claims such as "undetectable VPN"'),
  "product documentation lost the no-false-guarantee rule",
);

console.log("[detectability-contracts] transport and privacy-detectability invariants are aligned");
