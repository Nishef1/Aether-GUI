import type { ConnectionProfile } from "@/types/connection";

export type PathHealth = "healthy" | "suspect" | "failed";
export type PathTransport = "h2" | "h3" | "wg" | "gool" | "unknown";

export interface RuntimePathSelection {
  endpoint: string;
  transport: PathTransport;
}

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
  jitterMs: number | null;
  qualityScore: number | null;
  qualityConfidence: number | null;
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

function maskKeyForProfile(profile: ConnectionProfile, transport: PathTransport): string {
  if (transport !== "h2") return "mask:n/a";

  const mode = profile.masque_mask ?? (profile.fragment ? "legacy" : "off");
  if (mode === "legacy") {
    return `mask:legacy:${profile.fragment_size}@${profile.fragment_delay}`;
  }
  return `mask:${mode}`;
}

function masqueTlsKeys(profile: ConnectionProfile, transport: PathTransport): [string, string, string] {
  if (transport !== "h2" && transport !== "h3") {
    return ["ech:n/a", "tls:n/a", "groups:n/a"];
  }
  return [
    profile.ech.trim() ? "ech" : "no-ech",
    `tls:${profile.tls_profile ?? "automatic"}`,
    profile.tls_groups.trim() ? `groups:${profile.tls_groups.trim()}` : "groups:default",
  ];
}

export function pathIdForProfile(
  profile: ConnectionProfile,
  selection?: RuntimePathSelection | null,
): string {
  const transport = selection?.transport ?? inferTransport(profile);
  const endpoint = selection?.endpoint.trim() || endpointForProfile(profile, transport);
  const noize = transport === "wg" || transport === "gool" ? profile.wg_noize : profile.masque_noize;
  const [echKey, tlsKey, groupsKey] = masqueTlsKeys(profile, transport);
  return [
    transport,
    endpoint,
    profile.ip_version,
    profile.scan_mode,
    noize,
    maskKeyForProfile(profile, transport),
    echKey,
    tlsKey,
    groupsKey,
  ].join("|");
}

export function createObservedPath(
  profile: ConnectionProfile,
  now = Date.now(),
  selection?: RuntimePathSelection | null,
): ObservedPath {
  const transport = selection?.transport ?? inferTransport(profile);
  const endpoint = selection?.endpoint.trim() || endpointForProfile(profile, transport);
  return {
    id: pathIdForProfile(profile, selection),
    endpoint,
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
    jitterMs: null,
    qualityScore: null,
    qualityConfidence: null,
    countryCode: null,
    cooldownUntil: null,
  };
}

function confidenceFor(successes: number, failures: number): number {
  return Math.min(1, (successes + failures) / CONFIDENCE_SAMPLE_TARGET);
}

function boundedPercent(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : null;
}

export function recordPathSuccess(
  path: ObservedPath,
  input: {
    latencyMs: number | null;
    jitterMs?: number | null;
    qualityScore?: number | null;
    qualityConfidence?: number | null;
    countryCode: string | null;
    now?: number;
  },
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
    jitterMs: input.jitterMs ?? path.jitterMs,
    qualityScore: boundedPercent(input.qualityScore) ?? path.qualityScore,
    qualityConfidence: boundedPercent(input.qualityConfidence) ?? path.qualityConfidence,
    countryCode: input.countryCode?.toUpperCase() ?? path.countryCode,
    cooldownUntil: null,
  };
}

export function recordPathQuality(
  path: ObservedPath,
  input: {
    latencyMs?: number | null;
    jitterMs?: number | null;
    qualityScore?: number | null;
    qualityConfidence?: number | null;
    countryCode?: string | null;
    now?: number;
  },
): ObservedPath {
  const now = input.now ?? Date.now();
  return {
    ...path,
    lastSeenAt: now,
    latencyMs: input.latencyMs ?? path.latencyMs,
    jitterMs: input.jitterMs ?? path.jitterMs,
    qualityScore: boundedPercent(input.qualityScore) ?? path.qualityScore,
    qualityConfidence: boundedPercent(input.qualityConfidence) ?? path.qualityConfidence,
    countryCode: input.countryCode?.toUpperCase() ?? path.countryCode,
  };
}

export function recordPathFailure(
  path: ObservedPath,
  input: {
    now?: number;
    qualityScore?: number | null;
    qualityConfidence?: number | null;
  } = {},
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
    qualityScore: boundedPercent(input.qualityScore) ?? path.qualityScore,
    qualityConfidence: boundedPercent(input.qualityConfidence) ?? path.qualityConfidence,
    cooldownUntil: cooldownMs > 0 ? now + cooldownMs : null,
  };
}

export function scorePath(path: ObservedPath, now = Date.now()): number {
  if (path.cooldownUntil != null && path.cooldownUntil > now) return 0;

  const observations = path.successes + path.failures;
  const reliability = observations === 0 ? 0 : path.successes / observations;
  const latencyPenalty = path.latencyMs == null ? 0 : Math.min(path.latencyMs / 1000, 1);
  const jitterPenalty = path.jitterMs == null ? 0 : Math.min(path.jitterMs / 500, 1);
  const healthBonus = path.health === "healthy" ? 1 : path.health === "suspect" ? 0.35 : 0;
  const freshness = Math.max(0, 1 - Math.max(0, now - path.lastSeenAt) / FRESHNESS_WINDOW_MS);

  // Native quality already folds latency, jitter and recent probe health together.
  // Older persisted entries have no quality sample, so keep them neutral rather
  // than penalizing them until the next successful observation migrates them.
  const qualityEvidence =
    path.qualityScore == null
      ? 0.5
      : (path.qualityScore / 100) * (0.5 + ((path.qualityConfidence ?? 0) / 100) * 0.5);

  return Math.max(
    0,
    reliability * 0.34 +
      path.confidence * 0.16 +
      healthBonus * 0.16 +
      freshness * 0.14 +
      qualityEvidence * 0.2 -
      latencyPenalty * 0.05 -
      jitterPenalty * 0.03,
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
