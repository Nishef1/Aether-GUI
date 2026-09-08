import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const core = path.join(root, "vendor", "aether");

if (!existsSync(path.join(root, ".gitmodules"))) {
  throw new Error(".gitmodules is missing; custom Aether source is not pinned");
}

if (!existsSync(path.join(core, ".git")) && !existsSync(path.join(core, "aether", "Cargo.toml"))) {
  throw new Error("vendor/aether is not initialized; run git submodule update --init --recursive");
}

const sha = execFileSync("git", ["-C", core, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();

if (!/^[0-9a-f]{40}$/.test(sha)) {
  throw new Error(`Invalid vendor/aether commit: ${sha}`);
}

console.log(`[core] custom Aether pinned at ${sha}`);
