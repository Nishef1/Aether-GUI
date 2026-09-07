import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binaries = path.join(root, "src-tauri", "binaries");
const versions = JSON.parse(
  readFileSync(path.join(root, "scripts", "runtime-versions.json"), "utf8"),
);
const version = versions.singBox?.version;

if (typeof version !== "string" || !/^v\d+\.\d+\.\d+$/.test(version)) {
  console.error("Invalid sing-box version in scripts/runtime-versions.json");
  process.exit(2);
}

const windows = process.platform === "win32";
const command = windows ? "powershell.exe" : "bash";
const args = windows
  ? [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(binaries, "fetch-singbox.ps1"),
      "-DestDir",
      binaries,
      "-Version",
      version,
    ]
  : [
      path.join(binaries, "fetch-singbox.sh"),
      "--dest-dir",
      binaries,
      "--version",
      version,
    ];

const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
if (result.error) {
  console.error(`Failed to launch sing-box preparation: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
