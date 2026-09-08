import { scorePath, type ObservedPath, type PathTransport } from "@/lib/pathIntelligence";
import type { ConnectionProfile, H2MaskMode } from "@/types/connection";

export interface AutomaticCandidate {
  transport: Exclude<PathTransport, "unknown">;
  label: string;
  profile: ConnectionProfile;
  historical: boolean;
}

type AutomaticTransport = Exclude<PathTransport, "unknown">;

const DEFAULT_TRANSPORT_ORDER: AutomaticTransport[] = ["h3", "h2", "wg", "gool"];

function baselineTransport(profile: ConnectionProfile): AutomaticTransport {
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
): AutomaticTransport[] {
  const best = new Map<AutomaticTransport, number>();
  for (const path of paths) {
    if (!eligibleHistoricalTransport(path, now)) continue;
    const transport = path.transport as AutomaticTransport;
    best.set(transport, Math.max(best.get(transport) ?? 0, scorePath(path, now)));
  }
  return [...best.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([transport]) => transport);
}

function maskFromPathId(id: string): H2MaskMode | null {
  const part = id.split("|").find((value) => value.startsWith("mask:"));
  if (part === "mask:off") return "off";
  if (part === "mask:clienthello") return "clienthello";
  if (part === "mask:patterniha") return "patterniha";
  if (part?.startsWith("mask:legacy:")) return "legacy";
  return null;
}

function provenHistoricalH2Mask(
  paths: readonly ObservedPath[],
  now: number,
): Exclude<H2MaskMode, "off"> | null {
  const candidates = paths
    .filter((path) => path.transport === "h2" && eligibleHistoricalTransport(path, now))
    .map((path) => ({ path, mask: maskFromPathId(path.id) }))
    .filter(
      (entry): entry is { path: ObservedPath; mask: Exclude<H2MaskMode, "off"> } =>
        entry.mask != null && entry.mask !== "off",
    )
    .filter(({ path, mask }) => {
      if (mask === "patterniha") {
        return (
          path.successes >= 3 &&
          path.confidence >= 0.375 &&
          (path.qualityConfidence ?? 0) >= 50 &&
          scorePath(path, now) >= 0.55
        );
      }
      return path.successes >= 2 && scorePath(path, now) >= 0.52;
    })
    .sort((a, b) => scorePath(b.path, now) - scorePath(a.path, now));

  return candidates[0]?.mask ?? null;
}

function effectiveMask(profile: ConnectionProfile): H2MaskMode {
  return profile.masque_mask ?? (profile.fragment ? "legacy" : "off");
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
  transport: AutomaticTransport,
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
    case "gool": {
      const hasPinnedWiw = base.wiw_outer.trim() !== "" || base.wiw_inner.trim() !== "";
      return {
        ...profile,
        protocol: "gool",
        masque_http2: false,
        wiw_scan: preserveBaselineEndpoints && hasPinnedWiw ? base.wiw_scan : true,
      };
    }
  }
}

function labelFor(transport: AutomaticTransport): string {
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

function maskLabel(mask: H2MaskMode): string {
  switch (mask) {
    case "off":
      return "baseline";
    case "legacy":
      return "legacy mask";
    case "clienthello":
      return "ClientHello mask";
    case "patterniha":
      return "Patterniha experimental";
  }
}

function h2MasksForAutomaticAttempt(
  base: ConnectionProfile,
  paths: readonly ObservedPath[],
  now: number,
  baseline: boolean,
): Array<{ mask: H2MaskMode; historical: boolean }> {
  const selected = effectiveMask(base);

  // A non-off setting is an explicit user choice. Automatic mode may change
  // transports, but it does not silently A/B against a manually selected mask.
  if (selected !== "off") return [{ mask: selected, historical: false }];

  const proven = provenHistoricalH2Mask(paths, now);
  if (baseline) {
    return [
      { mask: "off", historical: false },
      { mask: proven ?? "clienthello", historical: proven != null },
    ];
  }

  if (proven != null) {
    return [
      { mask: proven, historical: true },
      { mask: "off", historical: false },
    ];
  }

  return [
    { mask: "off", historical: false },
    { mask: "clienthello", historical: false },
  ];
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
  const candidates: AutomaticCandidate[] = [];

  for (let index = 0; index < order.length; index += 1) {
    const transport = order[index];
    const isBaseline = index === 0;
    const transportHistorical = !isBaseline && history.includes(transport);
    const profile = profileForTransport(base, transport, isBaseline);

    if (transport !== "h2") {
      candidates.push({
        transport,
        label: labelFor(transport),
        profile,
        historical: transportHistorical,
      });
      continue;
    }

    const seen = new Set<H2MaskMode>();
    for (const variant of h2MasksForAutomaticAttempt(base, paths, now, isBaseline)) {
      if (seen.has(variant.mask)) continue;
      seen.add(variant.mask);
      candidates.push({
        transport,
        label: `${labelFor(transport)} · ${maskLabel(variant.mask)}`,
        profile: {
          ...profile,
          masque_mask: variant.mask,
          // Legacy mask owns the random fragment controls. Deterministic modes
          // must not inherit a stale legacy boolean from an old profile.
          fragment: variant.mask === "legacy" ? profile.fragment : false,
        },
        historical: transportHistorical || variant.historical,
      });
    }
  }

  return candidates;
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
