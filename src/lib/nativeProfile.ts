import { isAndroid } from "@/lib/platform";
import type { ConnectionProfile } from "@/types/connection";

const TLS_GROUPS_BRIDGE_PREFIX = "@profile=";
const IPV4_ONLY_BLOCK = "::/0";
const IPV6_ONLY_BLOCK = "0.0.0.0/0";
const CLOUDFLARE_DNS_V4 = ["1.1.1.1", "1.0.0.1"] as const;
const CLOUDFLARE_DNS_V6 = ["2606:4700:4700::1111", "2606:4700:4700::1001"] as const;

function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): value is T[number] {
  return typeof value === "string" && allowed.includes(value as T[number]);
}

function isTlsProfileMode(
  value: string,
): value is NonNullable<ConnectionProfile["tls_profile"]> {
  return oneOf(value, [
    "automatic",
    "current",
    "native-minimal",
    "compatibility",
    "experimental",
  ] as const);
}

function sanitizeEnums(profile: Partial<ConnectionProfile>): Partial<ConnectionProfile> {
  const sanitized = { ...profile };

  if (!oneOf(sanitized.protocol, ["auto", "masque", "wireguard", "gool"] as const)) {
    delete sanitized.protocol;
  }
  if (
    !oneOf(
      sanitized.scan_mode,
      ["turbo", "balanced", "thorough", "stealth", "ironclad"] as const,
    )
  ) {
    delete sanitized.scan_mode;
  }
  if (!oneOf(sanitized.ip_version, ["v4", "v6", "both"] as const)) {
    delete sanitized.ip_version;
  }
  if (
    !oneOf(
      sanitized.masque_noize,
      ["off", "light", "firewall", "balanced", "gfw", "aggressive"] as const,
    )
  ) {
    delete sanitized.masque_noize;
  }
  if (
    !oneOf(
      sanitized.wg_noize,
      ["off", "light", "firewall", "balanced", "gfw", "aggressive"] as const),
    )
  ) {
    delete sanitized.wg_noize;
  }
  if (
    sanitized.masque_mask !== undefined &&
    !oneOf(sanitized.masque_mask, ["off", "legacy", "clienthello", "patterniha"] as const)
  ) {
    delete sanitized.masque_mask;
  }
  if (
    sanitized.tls_profile !== undefined &&
    !oneOf(
      sanitized.tls_profile,
      ["automatic", "current", "native-minimal", "compatibility", "experimental"] as const,
    )
  ) {
    delete sanitized.tls_profile;
  }
  if (!oneOf(sanitized.perf_profile, ["auto", "low", "medium", "high"] as const)) {
    delete sanitized.perf_profile;
  }
  if (!oneOf(sanitized.zero_trust_auth, ["email", "service", "token"] as const)) {
    delete sanitized.zero_trust_auth;
  }

  return sanitized;
}

function splitRouteRules(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function familyGuard(ipVersion: ConnectionProfile["ip_version"] | undefined): string | null {
  if (ipVersion === "v4") return IPV4_ONLY_BLOCK;
  if (ipVersion === "v6") return IPV6_ONLY_BLOCK;
  return null;
}

function appendRouteBlock(value: string, rule: string): string {
  const entries = splitRouteRules(value);
  if (entries.includes(rule)) return value;
  return entries.length === 0 ? rule : `${value.trim()},${rule}`;
}

function stripRuntimeFamilyGuard(
  profile: Partial<ConnectionProfile>,
): Partial<ConnectionProfile> {
  if (typeof profile.route_block !== "string") return profile;
  const guard = familyGuard(profile.ip_version);
  if (guard == null) return profile;

  const entries = splitRouteRules(profile.route_block).filter((entry) => entry !== guard);
  return { ...profile, route_block: entries.join(",") };
}

function enforceIpFamily(profile: ConnectionProfile): ConnectionProfile {
  const guard = familyGuard(profile.ip_version);
  if (guard == null) return profile;

  return {
    ...profile,
    // IPv4/IPv6 in the UI is a strict runtime constraint, not just a scanner
    // preference. Route-block is evaluated before route-direct in Aether, so
    // the opposite family remains fail-closed on Android and desktop alike.
    route_block: appendRouteBlock(profile.route_block, guard),
  };
}

type DnsFamily = "v4" | "v6";
interface ParsedDnsToken {
  raw: string;
  family: DnsFamily;
  port: number;
}

function validIpv4(value: string): boolean {
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
  );
}

function parseDnsToken(raw: string): ParsedDnsToken | null {
  const token = raw.trim();
  if (!token) return null;

  if (token.startsWith("[")) {
    const end = token.indexOf("]");
    if (end <= 1) return null;
    const host = token.slice(1, end);
    if (!host.includes(":")) return null;
    const suffix = token.slice(end + 1);
    const port = suffix === "" ? 53 : /^:\d+$/.test(suffix) ? Number(suffix.slice(1)) : NaN;
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { raw: token, family: "v6", port };
  }

  const colonCount = [...token].filter((character) => character === ":").length;
  if (colonCount >= 2) return { raw: token, family: "v6", port: 53 };

  const separator = token.lastIndexOf(":");
  const host = separator > 0 ? token.slice(0, separator) : token;
  const port = separator > 0 ? Number(token.slice(separator + 1)) : 53;
  if (!validIpv4(host) || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { raw: token, family: "v4", port };
}

function defaultDns(ipVersion: ConnectionProfile["ip_version"]): readonly string[] {
  if (ipVersion === "v6") return CLOUDFLARE_DNS_V6;
  if (ipVersion === "both") return [...CLOUDFLARE_DNS_V4, ...CLOUDFLARE_DNS_V6];
  return CLOUDFLARE_DNS_V4;
}

function enforceDnsFamily(profile: ConnectionProfile): ConnectionProfile {
  const tokens = profile.dns
    .split(/[\s,;]+/)
    .map(parseDnsToken)
    .filter((token): token is ParsedDnsToken => token != null);

  const allowed = tokens.filter(
    (token) => profile.ip_version === "both" || token.family === profile.ip_version,
  );

  if (isAndroid && allowed.some((token) => token.port !== 53)) {
    throw new Error("Android system DNS resolvers must use port 53");
  }

  // Preserve malformed-only input so native validation can report it instead
  // of silently turning a typo into a default resolver. A valid but opposite-
  // family-only list is different: use the selected-family Cloudflare fallback.
  if (profile.dns.trim() !== "" && tokens.length === 0) return profile;

  return {
    ...profile,
    dns: (allowed.length > 0 ? allowed.map((token) => token.raw) : defaultDns(profile.ip_version)).join(","),
  };
}

/**
 * Converts process-boundary compatibility fields back into the public GUI model.
 * Invalid persisted enum values are dropped so normalized defaults win instead
 * of allowing an untyped native string to poison runtime policy state.
 */
export function decodeNativeConnectionProfile(
  profile: Partial<ConnectionProfile>,
): Partial<ConnectionProfile> {
  const sanitized = stripRuntimeFamilyGuard(sanitizeEnums(profile));
  if (!isAndroid || typeof sanitized.tls_groups !== "string") return sanitized;
  const raw = sanitized.tls_groups.trim();
  if (!raw.startsWith(TLS_GROUPS_BRIDGE_PREFIX)) return sanitized;

  const rest = raw.slice(TLS_GROUPS_BRIDGE_PREFIX.length);
  const separator = rest.indexOf(";groups=");
  const encodedProfile = separator >= 0 ? rest.slice(0, separator) : rest;
  const groups = separator >= 0 ? rest.slice(separator + ";groups=".length) : "";
  return {
    ...sanitized,
    tls_profile: isTlsProfileMode(encodedProfile) ? encodedProfile : "automatic",
    tls_groups: groups,
  };
}

/**
 * Produces the process-boundary profile used by every connection path. Strict
 * single-family selections and family-compatible DNS are enforced before
 * transport-specific conversion. Android additionally reuses tls_groups as a
 * compact TLS-profile bridge so the Kotlin IPC contract stays stable.
 */
export function profileForNativeInvoke(profile: ConnectionProfile): ConnectionProfile {
  const runtimeProfile = enforceDnsFamily(enforceIpFamily(profile));
  if (
    !isAndroid ||
    (runtimeProfile.protocol !== "masque" && runtimeProfile.protocol !== "auto")
  ) {
    return runtimeProfile;
  }
  const tlsProfile = runtimeProfile.tls_profile ?? "automatic";
  if (tlsProfile === "automatic") return runtimeProfile;
  const groups = runtimeProfile.tls_groups.trim();
  return {
    ...runtimeProfile,
    tls_groups: `${TLS_GROUPS_BRIDGE_PREFIX}${tlsProfile}${groups ? `;groups=${groups}` : ""}`,
  };
}
