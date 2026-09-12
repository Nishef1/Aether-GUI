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
