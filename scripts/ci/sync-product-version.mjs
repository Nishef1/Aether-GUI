import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tauriPath = path.join(root, "src-tauri/tauri.conf.json");
const packagePath = path.join(root, "package.json");
const packageLockPath = path.join(root, "package-lock.json");
const cargoPath = path.join(root, "src-tauri/Cargo.toml");
const cargoLockPath = path.join(root, "src-tauri/Cargo.lock");

const tauri = JSON.parse(fs.readFileSync(tauriPath, "utf8"));
const version = String(tauri.version ?? "").trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`Invalid product version in src-tauri/tauri.conf.json: ${version || "<empty>"}`);
}

function writeIfChanged(file, next) {
  const current = fs.readFileSync(file, "utf8");
  if (current === next) return false;
  fs.writeFileSync(file, next);
  return true;
}

const changed = [];

const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
pkg.version = version;
if (writeIfChanged(packagePath, `${JSON.stringify(pkg, null, 2)}\n`)) changed.push("package.json");

const lock = JSON.parse(fs.readFileSync(packageLockPath, "utf8"));
lock.version = version;
if (!lock.packages?.[""]) throw new Error("package-lock.json is missing the root package record");
lock.packages[""].version = version;
if (writeIfChanged(packageLockPath, `${JSON.stringify(lock, null, 2)}\n`)) changed.push("package-lock.json");

const cargo = fs.readFileSync(cargoPath, "utf8");
const cargoNext = cargo.replace(
  /(\[package\][\s\S]*?\nversion\s*=\s*")[^"]+("\s*\n)/,
  `$1${version}$2`,
);
if (cargoNext === cargo && !cargo.includes(`version = "${version}"`)) {
  throw new Error("Could not locate the root package version in src-tauri/Cargo.toml");
}
if (writeIfChanged(cargoPath, cargoNext)) changed.push("src-tauri/Cargo.toml");

const cargoLock = fs.readFileSync(cargoLockPath, "utf8");
const cargoLockNext = cargoLock.replace(
  /(\[\[package\]\]\s*\nname\s*=\s*"aether-gui"\s*\nversion\s*=\s*")[^"]+("\s*\n)/,
  `$1${version}$2`,
);
if (cargoLockNext === cargoLock && !cargoLock.includes(`name = "aether-gui"\nversion = "${version}"`)) {
  throw new Error("Could not locate the aether-gui package record in src-tauri/Cargo.lock");
}
if (writeIfChanged(cargoLockPath, cargoLockNext)) changed.push("src-tauri/Cargo.lock");

console.log(
  changed.length
    ? `[version] synchronized ${changed.join(", ")} to v${version}`
    : `[version] release metadata already synchronized at v${version}`,
);
