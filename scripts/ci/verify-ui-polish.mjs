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
    status.includes("secondary = friendlyConnectionError(status.phase, status.message)") &&
    !status.includes("secondary = status.message"),
  "raw transport/backend errors must not be dumped into the primary connection UI",
);

const sidecar = read("src/components/SidecarErrorScreen.tsx");
requireContract(
  sidecar.includes("<details") && sidecar.includes("Technical details"),
  "engine diagnostics must remain available without dominating the error screen",
);

console.log("[ui-polish] narrow-screen layout, preset disclosure and error presentation verified");
