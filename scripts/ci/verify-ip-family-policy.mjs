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
  'const IPV4_ONLY_BLOCK = "::/0"',
  'const IPV6_ONLY_BLOCK = "0.0.0.0/0"',
  "function enforceIpFamily",
  "route_block: appendRouteBlock(profile.route_block, guard)",
  "function stripRuntimeFamilyGuard",
  "function enforceDnsFamily",
  "Android system DNS resolvers must use port 53",
]) {
  requireContract(nativeProfile.includes(marker), `runtime family guard drifted: ${marker}`);
}

const automaticPolicy = read("src/lib/automaticPolicy.ts");
requireContract(
  automaticPolicy.includes("profileForTransport(base, transport, isBaseline)"),
  "Automatic no longer preserves the user's IP family across transport fallbacks",
);
for (const forbidden of ['ip_version: "both" as const', "dual-stack retry"]) {
  requireContract(
    !automaticPolicy.includes(forbidden),
    `Automatic silently widens a single-family selection: ${forbidden}`,
  );
}

const dnsPolicy = read("src-tauri/src/dns_policy.rs");
for (const marker of [
  "DEFAULT_DNS_V6",
  "effective_resolvers_for_ip_version",
  "profile_ip_version",
  'ip_version == "both"',
]) {
  requireContract(dnsPolicy.includes(marker), `DNS family policy drifted: ${marker}`);
}

const dnsPresets = read("src/lib/dnsProfile.ts");
for (const marker of [
  "2606:4700:4700::1111",
  "2a10:50c0::ad1:ff",
  "defaultDnsFor",
  "adblockDnsFor",
  "isAdblockDns",
]) {
  requireContract(dnsPresets.includes(marker), `DNS preset family semantics drifted: ${marker}`);
}

const dnsUi = read("src/components/DnsProtectionControl.tsx");
for (const marker of [
  "defaultDnsFor(ipVersion)",
  "adblockDnsFor(ipVersion)",
  "selected IP family",
]) {
  requireContract(dnsUi.includes(marker), `DNS UI family semantics drifted: ${marker}`);
}

const ipToggle = read("src/components/IpVersionToggle.tsx");
for (const marker of [
  'aria-label="Internet IP family"',
  "IPv4 only. IPv6 internet traffic stays blocked across Automatic fallbacks and every transport.",
  "IPv6 only. IPv4 internet traffic stays blocked across Automatic fallbacks and every transport.",
  "Dual stack. IPv4 and IPv6 internet traffic are both allowed",
  "isAdblockDns(dns)",
  "adblockDnsFor(next)",
]) {
  requireContract(ipToggle.includes(marker), `IP-family UI semantics drifted: ${marker}`);
}

// The selector remains a strict user policy, but live diagnostics must not
// present that configured policy as an observed runtime fact. Edge family is
// derived from the selected endpoint, while exit family is derived from the
// measured public IP. If neither has evidence, diagnostics must say so instead
// of guessing from profile.ip_version.
const diagnostics = read("src/components/ConnectionDiagnostics.tsx");
for (const marker of [
  "function endpointIpFamily",
  "function ipFamilyFromHost",
  "state.snapshot.public_ip",
  '" · Edge family pending"',
  "`Exit ${exitFamily}`",
]) {
  requireContract(diagnostics.includes(marker), `runtime diagnostics evidence drifted: ${marker}`);
}
for (const forbidden of [
  "return configuredIpLabel(profile)",
  "function configuredIpLabel",
  "IPv4 preferred",
  "IPv6 preferred",
]) {
  requireContract(
    !diagnostics.includes(forbidden),
    `diagnostics must not infer an observed IP family from configuration: ${forbidden}`,
  );
}

const androidRuntime = read("src-tauri/src/android.rs");
for (const marker of [
  "fn normalize_runtime_dns",
  "effective_resolvers_for_ip_version(&profile.dns, &profile.ip_version)",
  "DNS resolver family must match the selected Android IP family",
]) {
  requireContract(androidRuntime.includes(marker), `Android runtime family semantics drifted: ${marker}`);
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

console.log(
  "[ip-family-policy] selected family stays strict while live diagnostics only report observed edge/exit families",
);
