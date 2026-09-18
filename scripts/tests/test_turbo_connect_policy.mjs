import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");

function requireContract(condition, message) {
  if (!condition) throw new Error(`Turbo connect policy contract failed: ${message}`);
}

const automaticPolicy = read("src/lib/automaticPolicy.ts");
const autoConnect = read("src/lib/autoConnect.ts");
const commands = read("src-tauri/src/commands.rs");
const acceptance = read("src-tauri/src/connection_acceptance.rs");
const androidProbe = read(
  "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidEgressProbe.kt",
);
const androidService = read(
  "src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt",
);

requireContract(
  automaticPolicy.includes('scanMode === "turbo"') ||
    automaticPolicy.includes('scan_mode === "turbo"'),
  "historical ordering must explicitly distinguish Turbo from quality-ranked modes",
);
requireContract(
  automaticPolicy.includes("qualityConfidence") &&
    /turbo[\s\S]{0,1200}qualityConfidence/.test(automaticPolicy) === false,
  "Turbo historical selection must not require quality-confidence evidence",
);

requireContract(
  autoConnect.includes('candidate.profile.scan_mode !== "turbo"') &&
    autoConnect.includes("measureQuality"),
  "desktop Automatic must tell native acceptance to skip quality measurement in Turbo",
);
requireContract(
  commands.includes("measure_quality") && acceptance.includes("measure_quality"),
  "desktop acceptance API must expose an explicit quality-measurement switch",
);
requireContract(
  /if\s+measure_quality[\s\S]{0,500}quick_download_kbps/.test(acceptance),
  "desktop throughput probes must be conditional instead of mandatory",
);

requireContract(
  androidProbe.includes("measureCapacity: Boolean"),
  "Android egress verification must separate mandatory safety from optional capacity sampling",
);
requireContract(
  androidService.includes('profile.scanMode != "turbo"') &&
    androidService.includes("measureCapacity"),
  "Android Turbo startup must skip the capacity probe",
);
requireContract(
  /startEgressProbeLoop[\s\S]{0,1800}measureCapacity\s*=\s*true/.test(androidService),
  "Android must still collect capacity after the connection is ready",
);

console.log("Turbo reachability-first contracts verified");
