import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const core = path.join(root, "vendor", "aether");
const pinPath = path.join(root, "scripts", "ci", "custom-core-pin.json");

if (!existsSync(path.join(root, ".gitmodules"))) {
  throw new Error(".gitmodules is missing; custom Aether source is not pinned");
}
if (!existsSync(pinPath)) {
  throw new Error("scripts/ci/custom-core-pin.json is missing");
}
if (!existsSync(path.join(core, ".git")) && !existsSync(path.join(core, "aether", "Cargo.toml"))) {
  throw new Error("vendor/aether is not initialized; run git submodule update --init --recursive");
}

const pin = JSON.parse(readFileSync(pinPath, "utf8"));
if (pin.repository !== "Nishef1/Aether") {
  throw new Error(`Unexpected custom core repository: ${pin.repository}`);
}
if (!/^\d+\.\d+\.\d+$/.test(pin.version ?? "")) {
  throw new Error(`Invalid custom core version: ${pin.version}`);
}
if (!/^[0-9a-f]{40}$/.test(pin.commit ?? "")) {
  throw new Error(`Invalid custom core commit: ${pin.commit}`);
}

const sha = execFileSync("git", ["-C", core, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
if (sha !== pin.commit) {
  throw new Error(`vendor/aether is at ${sha}, expected ${pin.commit}`);
}

const cargo = readFileSync(path.join(core, "aether", "Cargo.toml"), "utf8");
const packageBlock = (cargo.match(/\[package\][\s\S]*?(?=\n\[|$)/) ?? [""])[0];
const version = packageBlock.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
if (version !== pin.version) {
  throw new Error(`vendor/aether version ${version ?? "unknown"} does not match pin ${pin.version}`);
}

console.log(`[core] custom Aether ${pin.version} pinned at ${sha}`);
