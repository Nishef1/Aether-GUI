import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendorRoot = path.join(root, "vendor", "aether");
const cargoManifest = path.join(vendorRoot, "aether", "Cargo.toml");
const runtimeManifest = JSON.parse(
  readFileSync(path.join(root, "scripts", "runtime-versions.json"), "utf8"),
);
const expectedVersion = String(runtimeManifest.aether?.version ?? "").replace(/^v/, "");
const windows = process.platform === "win32";
const target = path.join(root, "src-tauri", "binaries", windows ? "aether.exe" : "aether");
const stamp = path.join(root, "src-tauri", "binaries", "aether-version.txt");

if (!/^\d+\.\d+\.\d+$/.test(expectedVersion)) {
  throw new Error("Invalid Aether version in scripts/runtime-versions.json");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: options.capture ? "utf8" : undefined,
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? String(result.stderr || result.stdout || "").trim() : "";
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
  return options.capture ? String(result.stdout ?? "").trim() : "";
}

run("git", ["submodule", "update", "--init", "--recursive", "--checkout", "vendor/aether"]);

if (!existsSync(cargoManifest)) {
  throw new Error(
    "Custom Aether submodule is incomplete; expected vendor/aether/aether/Cargo.toml",
  );
}

const cargoToml = readFileSync(cargoManifest, "utf8");
const packageBlock = cargoToml.match(/\[package\][\s\S]*?(?=\n\[|$)/)?.[0] ?? "";
const coreVersion = packageBlock.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? "";
if (coreVersion !== expectedVersion) {
  throw new Error(
    `Custom core version ${coreVersion || "unknown"} does not match runtime baseline ${expectedVersion}`,
  );
}

const head = run("git", ["rev-parse", "HEAD"], { cwd: vendorRoot, capture: true });
const dirty = run("git", ["status", "--porcelain"], { cwd: vendorRoot, capture: true }).length > 0;
const stampValue = `custom:${head}${dirty ? ":dirty" : ""}`;

function reportsExpectedVersion(binary) {
  if (!existsSync(binary)) return false;
  const result = spawnSync(binary, ["--version"], { encoding: "utf8" });
  if (result.error || result.status !== 0) return false;
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.includes(expectedVersion);
}

if (!dirty && existsSync(target) && existsSync(stamp)) {
  const currentStamp = readFileSync(stamp, "utf8").trim();
  if (currentStamp === stampValue && reportsExpectedVersion(target)) {
    console.log(`[core] custom Aether ${expectedVersion} already prepared at ${head.slice(0, 12)}`);
    process.exit(0);
  }
}

console.log(`[core] building custom Aether ${expectedVersion} from ${head.slice(0, 12)}${dirty ? " (dirty)" : ""}`);
run(
  "cargo",
  ["build", "--release", "--manifest-path", cargoManifest],
  { env: { CARGO_TERM_COLOR: process.env.CARGO_TERM_COLOR ?? "always" } },
);

const built = path.join(
  vendorRoot,
  "aether",
  "target",
  "release",
  windows ? "aether.exe" : "aether",
);
if (!reportsExpectedVersion(built)) {
  throw new Error(`Built custom Aether does not report expected version ${expectedVersion}`);
}

mkdirSync(path.dirname(target), { recursive: true });
const staged = `${target}.new`;
copyFileSync(built, staged);
if (!windows) chmodSync(staged, 0o755);
rmSync(target, { force: true });
renameSync(staged, target);
writeFileSync(stamp, `${stampValue}\n`, "utf8");
console.log(`[core] custom Aether ${expectedVersion} ready from ${head.slice(0, 12)}`);
