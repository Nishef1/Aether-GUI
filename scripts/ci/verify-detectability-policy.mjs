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
  adaptive.includes('set_default("AETHER_WG_KEEPALIVE", defaults.wg_keepalive_secs)'),
  "scan policy no longer supplies a consistent WireGuard/WiW keepalive default",
);
requireContract(
  adaptive.includes("wg_keepalive_secs: 25"),
  "standard idle WireGuard keepalive default drifted from 25 seconds",
);

for (const [file, marker] of [
  ["src/state/connectionStore.ts", "keepalive: 25"],
  ["src-tauri/src/aether/profiles.rs", "25"],
  ["src-tauri/src/android.rs", "keepalive: 25"],
]) {
  requireContract(read(file).includes(marker), `${file} drifted from the core keepalive policy`);
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
