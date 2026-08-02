import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "prepare-android-native.sh");
const result = spawnSync("bash", [script], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});
if (result.error) {
  console.error(
    `Could not launch the Android native builder. Install Git Bash/WSL on Windows or Bash on Unix: ${result.error.message}`,
  );
  process.exit(1);
}
process.exit(result.status ?? 1);
