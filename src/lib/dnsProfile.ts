import type { IpVersion } from "@/types/connection";

export const CLOUDFLARE_DNS_V4 = "1.1.1.1,1.0.0.1";
export const CLOUDFLARE_DNS_V6 = "2606:4700:4700::1111,2606:4700:4700::1001";
export const ADGUARD_DNS_V4 = "94.140.14.14,94.140.15.15";
export const ADGUARD_DNS_V6 = "2a10:50c0::ad1:ff,2a10:50c0::ad2:ff";

function normalizedDnsSet(value: string): Set<string> {
  return new Set(
    value
      .split(/[\s,;]+/)
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean),
  );
}

function sameDnsSet(left: string, right: string): boolean {
  const a = normalizedDnsSet(left);
  const b = normalizedDnsSet(right);
  return a.size === b.size && [...a].every((value) => b.has(value));
}

export function defaultDnsFor(ipVersion: IpVersion): string {
  if (ipVersion === "v6") return CLOUDFLARE_DNS_V6;
  if (ipVersion === "both") return `${CLOUDFLARE_DNS_V4},${CLOUDFLARE_DNS_V6}`;
  return CLOUDFLARE_DNS_V4;
}

export function adblockDnsFor(ipVersion: IpVersion): string {
  if (ipVersion === "v6") return ADGUARD_DNS_V6;
  if (ipVersion === "both") return `${ADGUARD_DNS_V4},${ADGUARD_DNS_V6}`;
  return ADGUARD_DNS_V4;
}

/**
 * Native runtime persistence can contain the family-specific projection of the
 * AdGuard preset rather than the original dual-family UI value. Treat every
 * exact supported projection as the same semantic preset so a restart cannot
 * silently turn "Filter ads & trackers" into a generic custom-DNS state.
 */
export function isAdblockDns(value: string): boolean {
  return (
    sameDnsSet(value, ADGUARD_DNS_V4) ||
    sameDnsSet(value, ADGUARD_DNS_V6) ||
    sameDnsSet(value, `${ADGUARD_DNS_V4},${ADGUARD_DNS_V6}`)
  );
}
