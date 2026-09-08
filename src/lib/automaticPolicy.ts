import { scorePath, type ObservedPath, type PathTransport } from "@/lib/pathIntelligence";
import type { ConnectionProfile } from "@/types/connection";

export interface AutomaticCandidate {
  transport: Exclude<PathTransport, "unknown">;
  label: string;
  profile: ConnectionProfile;
  historical: boolean;
}

const DEFAULT_TRANSPORT_ORDER: Array<Exclude<PathTransport, "unknown">> = [
  "h3",
  "h2",
  "wg",
  "gool",
];

function baselineTransport(profile: ConnectionProfile): Exclude<PathTransport, "unknown"> {
  return profile.masque_http2 ? "h2" : "h3";
}

function eligibleHistoricalTransport(path: ObservedPath, now: number): boolean {
  return (
    path.transport !== "unknown" &&
    path.health === "healthy" &&
    path.successes >= 2 &&
    path.confidence >= 0.25 &&
    (path.cooldownUntil == null || path.cooldownUntil <= now) &&
    scorePath(path, now) >= 0.5 &&
    (path.qualityConfidence == null || path.qualityConfidence >= 40)
  );
}

function historicalTransportOrder(
  paths: readonly ObservedPath[],
  now = Date.now(),
): Array<Exclude<PathTransport, "unknown">> {
  const best = new Map<Exclude<PathTransport, "unknown">, number>();
  for (const path of paths) {
    if (!eligibleHistoricalTransport(path, now)) continue;
    const transport = path.transport as Exclude<PathTransport, "unknown">;
    best.set(transport, Math.max(best.get(transport) ?? 0, scorePath(path, now)));
  }
  return [...best.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([transport]) => transport);
}

function clearAutomaticEndpoints(profile: ConnectionProfile): ConnectionProfile {
  return {
    ...profile,
    peer: "",
    wg_peer: "",
    wiw_outer: "",
    wiw_inner: "",
    h2_peer: "",
  };
}

function profileForTransport(
  base: ConnectionProfile,
  transport: Exclude<PathTransport, "unknown">,
  preserveBaselineEndpoints: boolean,
): ConnectionProfile {
  const profile = preserveBaselineEndpoints ? { ...base } : clearAutomaticEndpoints(base);
  switch (transport) {
    case "h3":
      return {
        ...profile,
        protocol: "masque",
        masque_http2: false,
        wiw_scan: false,
      };
    case "h2":
      return {
        ...profile,
        protocol: "masque",
        masque_http2: true,
        wiw_scan: false,
      };
    case "wg":
      return {
        ...profile,
        protocol: "wireguard",
        masque_http2: false,
        wiw_scan: false,
      };
    case "gool":
      return {
        ...profile,
        protocol: "gool",
        masque_http2: false,
        wiw_scan: preserveBaselineEndpoints && (base.wiw_outer.trim() || base.wiw_inner.trim())
          ? base.wiw_scan
          : true,
      };
  }
}

function labelFor(transport: Exclude<PathTransport, "unknown">): string {
  switch (transport) {
    case "h3":
      return "MASQUE H3";
    case "h2":
      return "MASQUE H2";
    case "wg":
      return "WireGuard";
    case "gool":
      return "Warp-in-Warp";
  }
}

export function buildAutomaticCandidates(
  base: ConnectionProfile,
  paths: readonly ObservedPath[],
  now = Date.now(),
): AutomaticCandidate[] {
  if (base.protocol !== "auto") return [];

  const baseline = baselineTransport(base);
  const history = historicalTransportOrder(paths, now).filter((transport) => transport !== baseline);
  const fallbacks = DEFAULT_TRANSPORT_ORDER.filter(
    (transport) => transport !== baseline && !history.includes(transport),
  );
  const order = [baseline, ...history, ...fallbacks];

  return order.map((transport, index) => ({
    transport,
    label: labelFor(transport),
    profile: profileForTransport(base, transport, index === 0),
    historical: index > 0 && history.includes(transport),
  }));
}

export function automaticAttemptBudgetMs(profile: ConnectionProfile): number {
  const seconds = (() => {
    switch (profile.scan_mode) {
      case "turbo":
        return 75;
      case "balanced":
        return 150;
      case "thorough":
        return 330;
      case "stealth":
        return 210;
      case "ironclad":
        return 240;
    }
  })();
  return (seconds + 30) * 1000;
}
