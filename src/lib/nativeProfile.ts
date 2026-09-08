import { isAndroid } from "@/lib/platform";
import type { ConnectionProfile } from "@/types/connection";

const TLS_GROUPS_BRIDGE_PREFIX = "@profile=";

function isTlsProfileMode(
  value: string,
): value is NonNullable<ConnectionProfile["tls_profile"]> {
  return ["automatic", "current", "native-minimal", "compatibility", "experimental"].includes(
    value,
  );
}

/**
 * Converts the Android-only compact TLS bridge back into the public GUI model.
 * Old/mobile settings remain editable without exposing implementation syntax.
 */
export function decodeNativeConnectionProfile(
  profile: Partial<ConnectionProfile>,
): Partial<ConnectionProfile> {
  if (!isAndroid || typeof profile.tls_groups !== "string") return profile;
  const raw = profile.tls_groups.trim();
  if (!raw.startsWith(TLS_GROUPS_BRIDGE_PREFIX)) return profile;

  const rest = raw.slice(TLS_GROUPS_BRIDGE_PREFIX.length);
  const separator = rest.indexOf(";groups=");
  const encodedProfile = separator >= 0 ? rest.slice(0, separator) : rest;
  const groups = separator >= 0 ? rest.slice(separator + ";groups=".length) : "";
  return {
    ...profile,
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
