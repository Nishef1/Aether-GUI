import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const readJson = (relative) => JSON.parse(read(relative));

function requireContract(condition, message) {
  if (!condition) throw new Error(`[contracts] ${message}`);
}

const pkg = readJson("package.json");
const tauri = readJson("src-tauri/tauri.conf.json");
const runtime = readJson("scripts/runtime-versions.json");
const custom = readJson("scripts/ci/custom-core-pin.json");

requireContract(pkg.version === "1.0.0", `package version drifted to ${pkg.version}`);
requireContract(tauri.version === "1.0.0", `Tauri product version drifted to ${tauri.version}`);
requireContract(custom.repository === "Nishef1/Aether", `unexpected custom core repository ${custom.repository}`);
requireContract(custom.version === "1.9.0", `custom core version drifted to ${custom.version}`);
requireContract(runtime.aether?.version === `v${custom.version}`, "custom core version no longer matches the official runtime baseline");
requireContract(/^[0-9a-f]{40}$/.test(custom.commit ?? ""), "custom core pin is not a full commit SHA");

const nativeProfile = read("src/lib/nativeProfile.ts");
for (const mode of ["automatic", "current", "native-minimal", "compatibility", "experimental"]) {
  requireContract(nativeProfile.includes(`\"${mode}\"`), `native TLS bridge lost ${mode}`);
}
requireContract(nativeProfile.includes("decodeNativeConnectionProfile"), "native profile decoder is missing");
requireContract(nativeProfile.includes("profileForNativeInvoke"), "native profile encoder is missing");
requireContract(nativeProfile.includes("@profile="), "Android TLS bridge marker changed without a migration");

const connectionStore = read("src/state/connectionStore.ts");
requireContract(connectionStore.includes('from "@/lib/nativeProfile"'), "manual connect bypasses the shared native profile bridge");
requireContract(connectionStore.includes("decodeNativeConnectionProfile(profile)"), "persisted Android profiles bypass the shared decoder");
requireContract(connectionStore.includes("profileForNativeInvoke(profile)"), "manual connect bypasses the shared encoder");
requireContract(!connectionStore.includes('const TLS_GROUPS_BRIDGE_PREFIX = "@profile="'), "connection store reintroduced a duplicate TLS bridge marker");
requireContract(!connectionStore.includes("function decodeAndroidTlsBridge"), "connection store reintroduced a duplicate native decoder");

const autoConnect = read("src/lib/autoConnect.ts");
requireContract(autoConnect.includes("profileForNativeInvoke"), "Automatic v2 bypasses the shared native profile bridge");
requireContract(autoConnect.includes("profileForNativeInvoke(profile)"), "Automatic candidate launch no longer encodes the native profile");

const telemetryStore = read("src/state/telemetryStore.ts");
requireContract(telemetryStore.includes("profileForNativeInvoke(rerollProfile)"), "privacy reroll bypasses the shared native profile bridge");

const pathIntelligence = read("src/lib/pathIntelligence.ts");
for (const marker of ["ech:n/a", "tls:n/a", "groups:n/a"]) {
  requireContract(pathIntelligence.includes(marker), `non-MASQUE Path IDs lost ${marker}`);
}
requireContract(pathIntelligence.includes("masqueTlsKeys"), "TLS identity is no longer transport-scoped in Path Intelligence");

requireContract(pkg.scripts?.["prepare:aether"] === "node scripts/prepare-custom-aether.mjs", "default desktop core preparation is not the pinned custom core");
requireContract(pkg.scripts?.["prepare:android-native"] === "node scripts/prepare-android-native.mjs --custom", "default Android core preparation is not the pinned custom core");

console.log(`[contracts] Aether-GUI ${pkg.version} custom core integration verified at ${custom.commit.slice(0, 12)}`);
