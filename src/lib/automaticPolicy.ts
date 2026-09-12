import { scorePath, type ObservedPath, type PathTransport } from "@/lib/pathIntelligence";
import type { ConnectionProfile, H2MaskMode } from "@/types/connection";

export interface AutomaticCandidate {
  transport: Exclude<PathTransport, "unknown">;
  label: string;
  profile: ConnectionProfile;
  historical: boolean;
}

type AutomaticTransport = Exclude<PathTransport, "unknown">;

// Iran-first rescue order. It also minimizes avoidable website-facing tunnel
// fingerprints: prefer a single-hop path before the nested Warp-in-Warp path.
// H2/TCP gets the first clean shot, WireGuard is the next low-overhead family
// when UDP works, H3 follows after WG, and Gool remains the final fallback.
const DEFAULT_TRANSPORT_ORDER: AutomaticTransport[] = ["h2", "wg", "h3", "gool"];

function baselineTransport(profile: ConnectionProfile): AutomaticTransport {
  return profile.masque_http2 ? "h2" : "h3";
}

function eligibleHistoricalTransport(path: ObservedPath, now: number): boolean {
  return (
    path.transport !== "unknown" &&
    path.health === "healthy" &&
    path.successes >= 2 &&
    path.confidence >= 0.25 &&
    path.uploadLimited !== true &&
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

  // Turbo is a first-healthy policy. Do not burn another full transport attempt
  // on a speculative ClientHello mutation before trying a different carrier.
  // A mask that has already proven itself on this underlay is the only automatic
  // exception; otherwise compatibility masks stay a manual/Balanced rescue tool.
  if (base.scan_mode === "turbo") {
    if (baseline && proven != null) {
      return [
        { mask: "off", historical: false },
        { mask: proven, historical: true },
      ];
    }
    return [{ mask: proven ?? "off", historical: proven != null }];
  }

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

function pushH2Candidate(
  candidates: AutomaticCandidate[],
  profile: ConnectionProfile,
  mask: H2MaskMode,
  historical: boolean,
  labelSuffix?: string,
): void {
  candidates.push({
    transport: "h2",
    label: `${labelFor("h2")} · ${maskLabel(mask)}${labelSuffix ?? ""}`,
    profile: {
      ...profile,
      masque_mask: mask,
      // Legacy mask owns the random fragment controls. Deterministic modes
      // must not inherit a stale legacy boolean from an old profile.
      fragment: mask === "legacy" ? profile.fragment : false,
    },
    historical,
  });
}

export function buildAutomaticCandidates(
  base: ConnectionProfile,
  paths: readonly ObservedPath[],
  now = Date.now(),
): AutomaticCandidate[] {
  if (base.protocol !== "auto") return [];

  const baseline = baselineTransport(base);
  // Historical success can reorder single-hop transports, but it must never
  // promote the nested WiW path ahead of a single-hop fallback. Nested tunnels
  // add unavoidable RTT/MTU overhead that can become a website-visible signal;
  // keep WiW as the final reachability fallback unless the user selected it
  // explicitly as the protocol.
  const history = historicalTransportOrder(paths, now).filter(
    (transport) => transport !== baseline && transport !== "gool",
  );
  const fallbacks = DEFAULT_TRANSPORT_ORDER.filter(
    (transport) => transport !== baseline && !history.includes(transport),
  );
  const order = [baseline, ...history, ...fallbacks];
  const candidates: AutomaticCandidate[] = [];

  for (let index = 0; index < order.length; index += 1) {
    const transport = order[index];
    const isBaseline = index === 0;
    const transportHistorical = !isBaseline && history.includes(transport);
    // In Automatic mode an explicit v4/v6 selection is the preferred first
    // attempt, not a reason to strand every fallback on a broken address
    // family. Alternate transports use dual-stack without adding more scans.
    const transportBase =
      !isBaseline && base.ip_version !== "both" ? { ...base, ip_version: "both" as const } : base;
    const profile = profileForTransport(transportBase, transport, isBaseline);

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
      pushH2Candidate(
        candidates,
        profile,
        variant.mask,
        transportHistorical || variant.historical,
      );
    }
  }

  // One bounded final retry gives the baseline transport a chance on the other
  // address family too. This closes the v4/v6 blind spot without doubling the
  // entire candidate matrix (important for Thorough/Ironclad and battery life).
  if (base.ip_version !== "both") {
    const dualBase: ConnectionProfile = { ...base, ip_version: "both" };
    const dualProfile = profileForTransport(dualBase, baseline, false);
    if (baseline === "h2") {
      const variant = h2MasksForAutomaticAttempt(base, paths, now, false)[0];
      pushH2Candidate(candidates, dualProfile, variant.mask, variant.historical, " · dual-stack retry");
    } else {
      candidates.push({
        transport: baseline,
        label: `${labelFor(baseline)} · dual-stack retry`,
        profile: dualProfile,
        historical: false,
      });
    }
  }

  return candidates;
}

function transportForAttempt(profile: ConnectionProfile): AutomaticTransport {
  switch (profile.protocol) {
    case "masque":
      return profile.masque_http2 ? "h2" : "h3";
    case "wireguard":
      return "wg";
    case "gool":
      return "gool";
    case "auto":
      return baselineTransport(profile);
  }
}

function automaticScanBudgetSecs(profile: ConnectionProfile): number {
  const transport = transportForAttempt(profile);

  switch (profile.scan_mode) {
    case "turbo":
      // Fast/Gaming: enough time for a genuine data-plane result, then move on.
      if (transport === "gool") return 60;
      if (transport === "wg") return 40;
      return 30;
    case "balanced":
      if (transport === "gool") return 135;
      if (transport === "wg") return 105;
      return 90;
    case "thorough":
      if (transport === "gool") return 330;
      if (transport === "wg") return 300;
      return 270;
    case "stealth":
      if (transport === "gool") return 240;
      if (transport === "wg") return 210;
      return 180;
    case "ironclad":
      if (transport === "gool") return 270;
      if (transport === "wg") return 240;
      return 210;
  }
}

export function automaticAttemptBudgetMs(profile: ConnectionProfile): number {
  // Keep a fixed launch/stop grace outside the scan budget so slow process
  // startup never gets confused with an unhealthy transport.
  return (automaticScanBudgetSecs(profile) + 30) * 1000;
}
