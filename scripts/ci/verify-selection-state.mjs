import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function requireContract(condition, message) {
  if (!condition) throw new Error(`[selection-state] ${message}`);
}

const selectedToggleMarkers = [
  "data-[state=on]:bg-primary",
  "data-[state=on]:text-primary-foreground",
  "data-[state=on]:font-semibold",
  "data-[state=on]:ring-primary/80",
];

for (const file of [
  "src/components/ScanModeToggle.tsx",
  "src/components/NoizeProfileToggle.tsx",
  "src/components/MasqueTransportToggle.tsx",
  "src/components/IpVersionToggle.tsx",
]) {
  const source = read(file);
  for (const marker of selectedToggleMarkers) {
    requireContract(source.includes(marker), `${file} lost selected-state affordance: ${marker}`);
  }
}

const exitPreference = read("src/components/ExitPreferenceControl.tsx");
requireContract(
  exitPreference.includes('"bg-primary text-primary-foreground ring-primary shadow-sm"'),
  "connection-goal selection is no longer clearly highlighted",
);
requireContract(
  exitPreference.includes('selected ? "text-primary-foreground/75" : "text-muted-foreground"'),
  "selected connection-goal description can lose contrast on the orange surface",
);

const css = read("src/index.css");
requireContract(
  css.includes("--primary: #f2711c;"),
  "primary selection token is no longer the Aether orange",
);

console.log("[selection-state] active modes remain visibly orange and stateful");
