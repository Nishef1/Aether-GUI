import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");

function requireContract(condition, message) {
  if (!condition) throw new Error(`Timeout authority contract failed: ${message}`);
}

const automaticPolicy = read("src/lib/automaticPolicy.ts");
const autoConnect = read("src/lib/autoConnect.ts");
const connectionStore = read("src/state/connectionStore.ts");
const desktopStatus = read("src-tauri/src/aether/status.rs");
const androidPolicy = read(
  "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidTransportPolicy.kt",
);

requireContract(
  !automaticPolicy.includes("automaticScanBudgetSecs") &&
    !automaticPolicy.includes("automaticAttemptBudgetMs"),
  "frontend policy must not own transport scan deadlines",
);

requireContract(
  autoConnect.includes("AUTOMATIC_COORDINATOR_STALL_GUARD_MS") &&
    !autoConnect.includes("automaticAttemptBudgetMs") &&
    !autoConnect.includes("budgetMs: number"),
  "Automatic coordinator may keep only a transport-agnostic stall guard",
);

requireContract(
  !connectionStore.includes("androidStartupBudgetSecs") &&
    connectionStore.includes("scanBudgetSecs: null"),
  "connection store must not duplicate Android transport timeout tables",
);

requireContract(
  desktopStatus.includes("ESTABLISHMENT_MARGIN") &&
    desktopStatus.includes("Protocol::Wireguard | Protocol::Gool") &&
    desktopStatus.includes("Duration::from_secs(30)") &&
    desktopStatus.includes("Duration::from_secs(45)"),
  "desktop watchdog must be expressed as core scan budget plus establishment margin",
);

requireContract(
  androidPolicy.includes("ESTABLISHMENT_MARGIN_MS") &&
    androidPolicy.includes("coreScanBudgetMs") &&
    !androidPolicy.includes('"gool" -> 90_000L') &&
    !androidPolicy.includes('"wireguard" -> 70_000L'),
  "Android watchdog must mirror core deadlines plus one fixed margin",
);

console.log("Timeout authority contracts verified");
