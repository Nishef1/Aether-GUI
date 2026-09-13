import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function requireContract(condition, message) {
  if (!condition) throw new Error(`[disconnect-lifecycle] ${message}`);
}

const button = read("src/components/ConnectButton.tsx");
requireContract(
  button.includes('if (phase === "idle")') && !button.includes('phase === "idle" || phase === "error"'),
  "failed connections can retry without first resetting the native session",
);
requireContract(
  button.includes('error: "Reset failed connection"') && button.includes("void disconnectAndReset()"),
  "error-state connect control no longer performs an explicit reset",
);

const lifecycle = read("src/lib/disconnectLifecycle.ts");
for (const marker of [
  "DISCONNECT_TIMEOUT_MS",
  "DISCONNECT_RETRY_AFTER_MS",
  'invoke<ConnectionStatus>("get_status")',
  'await invoke("disconnect")',
  'status: { state: "Idle" }',
  'status: { state: "Disconnecting" }',
  'phase: "disconnect"',
  "runtimePath: null",
  "runtimeCapacity: null",
  "useAutomaticRuntimeStore.getState().clearAttempt()",
]) {
  requireContract(lifecycle.includes(marker), `explicit disconnect lost invariant: ${marker}`);
}
requireContract(
  lifecycle.includes("useConnectionStore.subscribe"),
  "stale session snapshots can visually override an in-progress explicit disconnect",
);
requireContract(
  lifecycle.includes("if (finalStatus.state === \"Idle\") return resetUiToIdle(attemptId)"),
  "disconnect can claim success without a final native Idle confirmation",
);

const android = read(
  "src-tauri/plugins/aether-vpn/android/src/main/java/FinalAetherVpnPlugin.kt",
);
for (const marker of [
  'AndroidVpnRuntime.updateSnapshot(FinalServiceSnapshot("Disconnecting"))',
  "val resources = detachAllResources()",
  "AndroidVpnRuntime.resetTelemetry()",
  "AndroidVpnRuntime.updateSnapshot(AndroidVpnRuntime.idleSnapshot())",
]) {
  requireContract(android.includes(marker), `Android explicit stop lost cleanup invariant: ${marker}`);
}

console.log("[disconnect-lifecycle] explicit teardown returns UI/native state to a clean baseline");
