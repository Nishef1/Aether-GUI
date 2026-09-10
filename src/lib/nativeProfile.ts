import { isAndroid } from "@/lib/platform";
import type { ConnectionProfile } from "@/types/connection";

const TLS_GROUPS_BRIDGE_PREFIX = "@profile=";

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
      ["off", "light", "firewall", "balanced", "gfw", "aggressive"] as const,
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

/**
 * Converts the Android-only compact TLS bridge back into the public GUI model.
 * Invalid persisted enum values are dropped so normalized defaults win instead
 * of allowing an untyped native string to poison the runtime policy state.
 */
export function decodeNativeConnectionProfile(
  profile: Partial<ConnectionProfile>,
): Partial<ConnectionProfile> {
  const sanitized = sanitizeEnums(profile);
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
 * Produces the process-boundary profile used by every connection path.
 * Desktop has a first-class TLS-profile field. Android deliberately reuses the
 * existing tls_groups string so the Kotlin contract stays stable while the
 * custom Core decodes the profile before applying key-share groups.
 */
export function profileForNativeInvoke(profile: ConnectionProfile): ConnectionProfile {
  if (!isAndroid || (profile.protocol !== "masque" && profile.protocol !== "auto")) {
    return profile;
  }
  const tlsProfile = profile.tls_profile ?? "automatic";
  if (tlsProfile === "automatic") return profile;
  const groups = profile.tls_groups.trim();
  return {
    ...profile,
    tls_groups: `${TLS_GROUPS_BRIDGE_PREFIX}${tlsProfile}${groups ? `;groups=${groups}` : ""}`,
  };
}
