import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function requireContract(condition, message) {
  if (!condition) throw new Error(`[ui-polish] ${message}`);
}

const scan = read("src/components/ScanModeToggle.tsx");
requireContract(
  scan.includes("grid-cols-3") && scan.includes("min-[420px]:grid-cols-5"),
  "route discovery must stay roomy on narrow phones and return to five columns on wider layouts",
);

const quick = read("src/components/QuickConnectionCard.tsx");
requireContract(
  quick.includes("H2 · Turbo · IPv4 · Firewall"),
  "Fast / Gaming must disclose the main settings it applies",
);

const status = read("src/components/ConnectionStatusLine.tsx");
requireContract(
  status.includes("friendlyConnectionError") &&
    status.includes("secondary = friendlyConnectionError(status.phase, status.message)"),
  "friendly connection guidance disappeared from the primary status presentation",
);
for (const marker of [
  "useReducedMotion",
  'mode="popLayout"',
  'initial={false}',
  "Technical details",
  'status.state === "Error" && (',
  "{status.message}",
  "break-words whitespace-pre-wrap",
]) {
  requireContract(status.includes(marker), `connection status polish/diagnostic contract drifted: ${marker}`);
}
requireContract(
  !status.includes("line-clamp-3"),
  "connection errors can be visually truncated before users can inspect them",
);

const connectButton = read("src/components/ConnectButton.tsx");
for (const marker of [
  "useReducedMotion",
  'mode="popLayout"',
  'initial={false}',
  "reduceMotion || isAndroid",
  "scale: 0.98",
]) {
  requireContract(connectButton.includes(marker), `connect-orb motion contract drifted: ${marker}`);
}
requireContract(
  !connectButton.includes('mode="wait"'),
  "connect-orb icon transitions regressed to wait-mode flicker/gaps",
);

const systemTunnel = read("src-tauri/src/system_tunnel/mod.rs");
for (const marker of [
  "[system-tunnel]",
  "start failed:",
  "runtime failed:",
  "data path verified:",
  "LOG_EVENT",
]) {
  requireContract(systemTunnel.includes(marker), `system-tunnel diagnostics lost explicit log marker: ${marker}`);
}

const sidecar = read("src/components/SidecarErrorScreen.tsx");
requireContract(
  sidecar.includes("<details") && sidecar.includes("Technical details"),
  "engine diagnostics must remain available without dominating the error screen",
);

console.log(
  "[ui-polish] motion, reduced-motion handling and full system-tunnel diagnostics verified",
);
