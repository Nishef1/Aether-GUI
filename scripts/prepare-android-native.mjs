import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const customCore = process.argv.includes("--custom");

function configureGeneratedAndroidProject() {
  const gradlePath = path.join(root, "src-tauri", "gen", "android", "app", "build.gradle.kts");
  if (!existsSync(gradlePath)) return;

  const marker = "// Aether native executable packaging";
  let source = readFileSync(gradlePath, "utf8");
  if (source.includes(marker)) return;

  const androidBlock = /android\s*\{\r?\n/;
  if (!androidBlock.test(source)) {
    throw new Error(`Could not locate the Android DSL block in ${gradlePath}`);
  }

  const packaging = `    ${marker}\n    packaging {\n        jniLibs {\n            // libaether_exec.so is launched by file path, so native libraries\n            // must be extracted instead of only mmap'd from the APK.\n            useLegacyPackaging = true\n            // These release artifacts are already optimized/stripped.\n            keepDebugSymbols += setOf(\n                "**/libaether_exec.so",\n                "**/libaethertun.so",\n                "**/libhev-socks5-tunnel.so",\n            )\n        }\n    }\n\n`;
  source = source.replace(androidBlock, (match) => `${match}${packaging}`);
  writeFileSync(gradlePath, source);
  console.log("[android-native] configured extracted ARM64 native library packaging");
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

configureGeneratedAndroidProject();

if (customCore) {
  run("git", ["submodule", "update", "--init", "--recursive", "--checkout", "vendor/aether"]);
  run(process.execPath, [path.join(root, "scripts", "ci", "verify-custom-aether-pin.mjs")]);
}

const script = path.join(root, "scripts", "prepare-android-native.sh");
const result = spawnSync("bash", [script], {
  cwd: root,
  env: {
    ...process.env,
    ...(customCore ? { AETHER_CUSTOM_CORE: "1" } : {}),
  },
  stdio: "inherit",
});
if (result.error) {
  console.error(
    `Could not launch the Android native builder. Install Git Bash/WSL on Windows or Bash on Unix: ${result.error.message}`,
  );
  process.exit(1);
}
process.exit(result.status ?? 1);
