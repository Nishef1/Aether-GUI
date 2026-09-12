import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function requireContract(condition, message) {
  if (!condition) throw new Error(`[ip-family-policy] ${message}`);
}

const nativeProfile = read("src/lib/nativeProfile.ts");
for (const marker of [
  'const ANDROID_IPV4_ONLY_BLOCK = "::/0"',
  'const ANDROID_IPV6_ONLY_BLOCK = "0.0.0.0/0"',
  "function enforceAndroidIpFamily",
  "route_block: appendRouteBlock(profile.route_block, guard)",
  "function stripRuntimeFamilyGuard",
]) {
  requireContract(nativeProfile.includes(marker), `runtime family guard drifted: ${marker}`);
}

const ipToggle = read("src/components/IpVersionToggle.tsx");
for (const marker of [
  'aria-label="Internet IP family"',
  "IPv4 only. IPv6 internet traffic is blocked at runtime on Android",
  "IPv6 only. IPv4 internet traffic is blocked at runtime on Android",
  "Dual stack. IPv4 and IPv6 internet traffic are both allowed",
]) {
  requireContract(ipToggle.includes(marker), `IP-family UI semantics drifted: ${marker}`);
}

const coreCli = read("vendor/aether/aether/src/cli.rs");
requireContract(
  coreCli.includes("-4                       scan/connect over IPv4 only"),
  "custom Core no longer defines -4 as IPv4-only scan/connect",
);
requireContract(
  coreCli.includes("-6                       scan/connect over IPv6 only"),
  "custom Core no longer defines -6 as IPv6-only scan/connect",
);

console.log("[ip-family-policy] selected internet family is enforced at the Android runtime boundary");
