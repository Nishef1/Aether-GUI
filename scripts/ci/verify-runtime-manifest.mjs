import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifestPath = path.join(root, "scripts", "runtime-versions.json");
const versions = JSON.parse(readFileSync(manifestPath, "utf8"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(/^v\d+\.\d+\.\d+$/.test(versions.aether?.version ?? ""), "Invalid Aether version");
assert(/^[0-9a-f]{40}$/.test(versions.aether?.commit ?? ""), "Invalid Aether commit");
assert(/^v\d+\.\d+\.\d+$/.test(versions.singBox?.version ?? ""), "Invalid sing-box version");
assert(/^\d+\.\d+\.\d+$/.test(versions.hev?.version ?? ""), "Invalid HEV version");

const consumers = [
  "scripts/prepare-sidecars.mjs",
  "scripts/prepare-android-native.sh",
  "src-tauri/binaries/fetch-aether.sh",
  "src-tauri/binaries/fetch-aether.ps1",
];

for (const relative of consumers) {
  const content = readFileSync(path.join(root, relative), "utf8");
  assert(
    content.includes("runtime-versions.json"),
    `${relative} must read scripts/runtime-versions.json instead of pinning its own version`,
  );
}

console.log(
  `[runtime] Aether ${versions.aether.version} @ ${versions.aether.commit.slice(0, 12)}; ` +
    `sing-box ${versions.singBox.version}; HEV ${versions.hev.version}`,
);
