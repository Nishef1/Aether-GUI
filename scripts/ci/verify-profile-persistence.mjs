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
  "persistSuccessfulAutomaticIntent(base)",
  "if (acceptance.accepted)",
  "if (profile.runtime_only) return null",
  "last_successful_profile",
]) {
  requireContract(
    autoConnect.includes(marker),
    `successful Automatic intent persistence drifted: ${marker}`,
  );
}
requireContract(
  autoConnect.indexOf("persistSuccessfulAutomaticIntent(base)") >
    autoConnect.indexOf("if (acceptance.accepted)"),
  "Automatic intent can be persisted before the winning candidate passes acceptance",
);

const telemetryStore = read("src/state/telemetryStore.ts");
for (const marker of [
  "quick_reconnect: false",
  "runtime_only: true",
  "Privacy reroll changes runtime behavior only",
]) {
  requireContract(
    telemetryStore.includes(marker),
    `Privacy reroll can overwrite durable user settings: ${marker}`,
  );
}

const desktopProfiles = read("src-tauri/src/aether/profiles.rs");
for (const marker of [
  'const STORE_KEY: &str = "last_successful_profile"',
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

const nativeProfile = read("src/lib/nativeProfile.ts");
for (const marker of [
  "const sanitized = { ...profile }",
  "const runtimeProfile = enforceDnsFamily(enforceIpFamily(profile))",
  "return runtimeProfile",
]) {
  requireContract(
    nativeProfile.includes(marker),
    `native profile projection may drop the runtime-only marker: ${marker}`,
  );
}

console.log(
  "[profile-persistence] successful user intent persists while runtime candidates and privacy rerolls stay transient",
);
