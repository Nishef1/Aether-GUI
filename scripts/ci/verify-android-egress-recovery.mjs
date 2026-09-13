import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = readFileSync(
  path.join(
    root,
    "src-tauri/plugins/aether-vpn/android/src/main/java/AndroidEgressProbe.kt",
  ),
  "utf8",
);

function requireContract(condition, message) {
  if (!condition) throw new Error(`Android egress recovery contract failed: ${message}`);
}

const localConnectTimeout = Number(
  source.match(/LOCAL_PROXY_CONNECT_TIMEOUT_MS\s*=\s*([\d_]+)/)?.[1]?.replaceAll("_", "") ?? NaN,
);
const recoveryWindow = Number(
  source.match(/LOCAL_RECOVERY_WINDOW_MS\s*=\s*([\d_]+)L?/)?.[1]?.replaceAll("_", "") ?? NaN,
);
const recoveries = Number(
  source.match(/MAX_LOCAL_RECOVERIES\s*=\s*(\d+)/)?.[1] ?? NaN,
);

requireContract(
  Number.isFinite(localConnectTimeout) && localConnectTimeout <= 1_500,
  "loopback connect must fail fast instead of waiting several seconds on a recycled Core listener",
);
requireContract(
  Number.isFinite(recoveryWindow) && recoveryWindow >= 10_000,
  "Core route recycling needs a bounded grace window long enough to revalidate a replacement route",
);
requireContract(
  Number.isFinite(recoveries) && recoveries >= 1,
  "at least one local listener recycle must be recoverable before the TUN attempt is failed",
);
requireContract(
  source.includes("waitForLocalProxyRecovery") && source.includes("localProxyListening"),
  "egress verification must distinguish remote probe failure from temporary loopback listener loss",
);
requireContract(
  source.includes("retrying on the recovered route"),
  "a recovered Core route must restart identity verification instead of falling through to Error",
);
requireContract(
  !source.includes('error("SOCKS end-to-end egress failed'),
  "Native TUN users must not receive the internal loopback handoff as the primary user-facing error",
);
requireContract(
  source.includes("failWithDiagnostics") && source.includes("appendServiceLine"),
  "provider-level diagnostics must remain available without flooding the main connection error",
);

console.log("Android egress recovery contracts verified");
