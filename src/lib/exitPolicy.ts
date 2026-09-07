export type ExitPreference = "low-latency" | "privacy";

export const EXIT_RETRY_LIMIT = 6;

// Curated pool for the privacy-oriented mode. This is deliberately an allowlist,
// not a geopolitical blocklist: unknown/other locations remain usable in
// low-latency mode but are not presented as privacy-preferred exits.
export const PRIVACY_PREFERRED_COUNTRIES = new Set([
  "AT",
  "CA",
  "CH",
  "DE",
  "DK",
  "FI",
  "FR",
  "GB",
  "IE",
  "IS",
  "JP",
  "NL",
  "NO",
  "SE",
  "SG",
  "US",
]);

export function isPrivacyPreferredExit(countryCode: string | null | undefined): boolean {
  if (!countryCode) return false;
  return PRIVACY_PREFERRED_COUNTRIES.has(countryCode.trim().toUpperCase());
}

export function normalizeExitPreference(value: string | null | undefined): ExitPreference {
  return value === "privacy" ? "privacy" : "low-latency";
}
