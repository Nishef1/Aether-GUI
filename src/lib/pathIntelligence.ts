import type { ConnectionProfile } from "@/types/connection";

export type PathHealth = "healthy" | "suspect" | "failed";
export type PathTransport = "h2" | "h3" | "wg" | "gool" | "unknown";

export interface ObservedPath {
  id: string;
  endpoint: string;
  transport: PathTransport;
  health: PathHealth;
  successes: number;
  failures: number;
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastSeenAt: number;
  confidence: number;
  latencyMs: number | null;
  countryCode: string | null;
  cooldownUntil: number | null;
}

export const MAX_PATHS = 32;
const CONFIDENCE_SAMPLE_TARGET = 8;
const FAILURE_COOLDOWN_MS = [0, 30_000, 120_000, 300_000] as const;
const FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1000;

function inferTransport(profile: ConnectionProfile): PathTransport {
  switch (profile.protocol) {
    case "masque":
      return profile.masque_http2 ? "h2" : "h3";
    case "wireguard":
      return "wg";
    case "gool":
      return "gool";
    default:
      return "unknown";
  }
}

function endpointForProfile(profile: ConnectionProfile, transport: PathTransport): string {
  switch (transport) {
    case "h2":
      return profile.h2_peer.trim() || profile.peer.trim() || "auto";
    case "h3":
      return profile.peer.trim() || "auto";
    case "wg":
      return profile.peer.trim() || profile.wg_peer.trim() || "auto";
    case "gool": {
      const outer = profile.wiw_outer.trim() || profile.wg_peer.trim();
      const inner = profile.wiw_inner.trim();
      return outer || inner ? `${outer || "auto"}>${inner || "auto"}` : "auto";
    }
    default:
      return "auto";
  }
}

export function pathIdForProfile(profile: ConnectionProfile): string {
  const transport = inferTransport(profile);
  const endpoint = endpointForProfile(profile, transport);
  const noize = transport === "wg" || transport === "gool" ? profile.wg_noize : profile.masque_noize;
  return [
    transport,
    endpoint,
    profile.ip_version,
    profile.scan_mode,
    noize,
    profile.fragment ? `${profile.fragment_size}@${profile.fragment_delay}` : "no-fragment",
    profile.ech.trim() ? "ech" : "no-ech",
    profile.tls_groups.trim() || "default-groups",
  ].join("|");
}

export function createObservedPath(profile: ConnectionProfile, now = Date.now()): ObservedPath {
  const transport = inferTransport(profile);
  return {
    id: pathIdForProfile(profile),
    endpoint: endpointForProfile(profile, transport),
    transport,
    health: "suspect",
    successes: 0,
    failures: 0,
    consecutiveFailures: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastSeenAt: now,
    confidence: 0,
    latencyMs: null,
    countryCode: null,
    cooldownUntil: null,
  };
}

function confidenceFor(successes: number, failures: number): number {
  return Math.min(1, (successes + failures) / CONFIDENCE_SAMPLE_TARGET);
}

export function recordPathSuccess(
  path: ObservedPath,
  input: { latencyMs: number | null; countryCode: string | null; now?: number },
): ObservedPath {
  const now = input.now ?? Date.now();
  const successes = path.successes + 1;
  return {
    ...path,
    health: "healthy",
    successes,
    consecutiveFailures: 0,
    lastSuccessAt: now,
    lastSeenAt: now,
    confidence: confidenceFor(successes, path.failures),
    latencyMs: input.latencyMs ?? path.latencyMs,
    countryCode: input.countryCode?.toUpperCase() ?? path.countryCode,
    cooldownUntil: null,
  };
}

export function recordPathFailure(
  path: ObservedPath,
  input: { now?: number } = {},
): ObservedPath {
  const now = input.now ?? Date.now();
  const failures = path.failures + 1;
  const consecutiveFailures = path.consecutiveFailures + 1;
  const cooldownIndex = Math.min(consecutiveFailures, FAILURE_COOLDOWN_MS.length - 1);
  const cooldownMs = FAILURE_COOLDOWN_MS[cooldownIndex];
  return {
    ...path,
    health: consecutiveFailures >= 3 ? "failed" : "suspect",
    failures,
    consecutiveFailures,
    lastFailureAt: now,
    lastSeenAt: now,
    confidence: confidenceFor(path.successes, failures),
    cooldownUntil: cooldownMs > 0 ? now + cooldownMs : null,
  };
}

export function scorePath(path: ObservedPath, now = Date.now()): number {
  if (path.cooldownUntil != null && path.cooldownUntil > now) return 0;

  const observations = path.successes + path.failures;
  const reliability = observations === 0 ? 0 : path.successes / observations;
  const latencyPenalty = path.latencyMs == null ? 0 : Math.min(path.latencyMs / 1000, 1);
  const healthBonus = path.health === "healthy" ? 1 : path.health === "suspect" ? 0.35 : 0;
  const freshness = Math.max(0, 1 - (now - path.lastSeenAt) / FRESHNESS_WINDOW_MS);

  return Math.max(
    0,
    reliability * 0.42 +
      path.confidence * 0.22 +
      healthBonus * 0.18 +
      freshness * 0.18 -
      latencyPenalty * 0.08,
  );
}

export function rankPaths(paths: readonly ObservedPath[], now = Date.now()): ObservedPath[] {
  return [...paths]
    .sort((a, b) => {
      const scoreDelta = scorePath(b, now) - scorePath(a, now);
      return scoreDelta !== 0 ? scoreDelta : b.lastSeenAt - a.lastSeenAt;
    })
    .slice(0, MAX_PATHS);
}
