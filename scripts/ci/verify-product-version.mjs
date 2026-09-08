import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const expected = "1.0.0";
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const readJson = (relative) => JSON.parse(read(relative));
const mismatches = [];

function expectVersion(label, actual) {
  if (actual !== expected) mismatches.push(`${label}=${actual || "<missing>"}`);
}

const pkg = readJson("package.json");
const tauri = readJson("src-tauri/tauri.conf.json");
const lock = readJson("package-lock.json");

expectVersion("package.json", pkg.version);
expectVersion("src-tauri/tauri.conf.json", tauri.version);
expectVersion("package-lock.json", lock.version);
expectVersion("package-lock.json root", lock.packages?.[""]?.version);

const cargoToml = read("src-tauri/Cargo.toml");
const cargoPackage = cargoToml.match(/\[package\][\s\S]*?(?=\n\[|$)/)?.[0] ?? "";
const cargoVersion = cargoPackage.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? "";
expectVersion("src-tauri/Cargo.toml", cargoVersion);

const cargoLockVersion = read("src-tauri/Cargo.lock").match(
  /\[\[package\]\]\s*\r?\nname\s*=\s*"aether-gui"\s*\r?\nversion\s*=\s*"([^"]+)"/,
)?.[1] ?? "";
expectVersion("src-tauri/Cargo.lock", cargoLockVersion);

if (mismatches.length) {
  throw new Error(`[version] expected ${expected}: ${mismatches.join(", ")}`);
}

console.log(`[version] product metadata locked at v${expected}`);
