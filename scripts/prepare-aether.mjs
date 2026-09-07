import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binaries = path.join(root, "src-tauri", "binaries");
const windows = process.platform === "win32";
const command = windows ? "powershell.exe" : "bash";
const script = path.join(binaries, windows ? "fetch-aether.ps1" : "fetch-aether.sh");
const args = windows
  ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script]
  : [script];

const result = spawnSync(command, args, {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  console.error(`Failed to launch Aether core preparation: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
