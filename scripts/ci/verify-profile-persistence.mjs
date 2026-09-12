import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function requireContract(condition, message) {
  if (!condition) throw new Error(`[profile-persistence] ${message}`);
}

const types = read("src/types/connection.ts");
requireContract(
  types.includes("runtime_only?: boolean"),
  "frontend profile lost the transient-runtime marker",
);

const automaticPolicy = read("src/lib/automaticPolicy.ts");
for (const marker of [
  "runtime_only: true",
  "Candidate mutations are execution details, not user settings",
]) {
  requireContract(
    automaticPolicy.includes(marker),
    `Automatic candidates can become persisted user intent: ${marker}`,
  );
}

const autoConnect = read("src/lib/autoConnect.ts");
for (const marker of [
  'invoke("set_default_profile"',
  "runtime_only: false",
  "persistAutomaticIntent(base)",
  '"profile-persistence"',
]) {
  requireContract(
    autoConnect.includes(marker),
    `Automatic base profile is not durably saved before candidate expansion: ${marker}`,
  );
}

const desktopProfiles = read("src-tauri/src/aether/profiles.rs");
for (const marker of [
  "pub runtime_only: bool",
  "if profile.runtime_only",
  "persisted.runtime_only = false",
  "runtime_only: false",
]) {
  requireContract(
    desktopProfiles.includes(marker),
    `desktop runtime candidate can overwrite the saved profile: ${marker}`,
  );
}

const android = read("src-tauri/src/android.rs");
for (const marker of [
  "runtime_only: bool",
  "let mut runtime_profile = profile_override.unwrap_or_else(|| settings.profile.clone())",
  "if !runtime_profile.runtime_only",
  "profile.runtime_only = false",
  "sanitized.runtime_only = false",
  "vpn_profile(runtime_profile, tunnel)",
]) {
  requireContract(
    android.includes(marker),
    `Android runtime candidate and saved profile are no longer separated: ${marker}`,
  );
}

console.log(
  "[profile-persistence] user intent stays persisted while Automatic candidates remain runtime-only",
);
