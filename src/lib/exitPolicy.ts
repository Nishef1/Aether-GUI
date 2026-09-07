export type ExitPreference = "low-latency" | "privacy";

// WARP does not expose deterministic country selection. Two automatic rerolls
// are enough to sample fresh routes without turning mobile privacy mode into a
// long radio/CPU loop. The UI offers an explicit manual retry after this budget.
export const EXIT_RETRY_LIMIT = 2;

// Curated pool for the privacy-oriented mode. This is deliberately an allowlist,
// not a geopolitical blocklist: unknown/other locations remain usable in
// low-latency mode but are not presented as privacy-preferred exits.
export const PRIVACY_PREFERRED_COUNTRIES = new Set([
  "AT",
  "AU",
  "BE",
  "CA",
  "CH",
  "DE",
  "DK",
  "ES",
  "FI",
  "FR",
  "GB",
  "IE",
  "IS",
  "JP",
  "LU",
  "NL",
  "NO",
  "NZ",
  "PT",
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
