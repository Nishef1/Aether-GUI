import { spawnSync } from "node:child_process";

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.error) {
    console.error(`${command} failed to start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, ["scripts/prepare-android-native.mjs"]);
const env = { ...process.env, VITE_AETHER_PLATFORM: "android" };
const executable = process.platform === "win32" ? "npx.cmd" : "npx";
run(executable, ["tsc", "-b"], env);
run(executable, ["vite", "build"], env);
