import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binaries = path.join(root, "src-tauri", "binaries");
const version = "v1.13.12";
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
