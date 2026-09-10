import { Activity, Gauge, Globe2, Network, ShieldCheck } from "lucide-react";
import { useAutomaticRuntimeStore } from "@/state/automaticRuntimeStore";
import { useConnectionStore } from "@/state/connectionStore";
import { useSystemTunnelStore } from "@/state/systemTunnelStore";
import { useTelemetryStore } from "@/state/telemetryStore";
import type { ConnectionProfile } from "@/types/connection";

function inferredTransport(profile: ConnectionProfile): string {
  switch (profile.protocol) {
    case "masque":
      return profile.masque_http2 ? "H2" : "H3";
    case "wireguard":
      return "WireGuard";
    case "gool":
      return "Warp-in-Warp";
    case "auto":
      return "Pending";
  }
}

function configuredIpLabel(profile: ConnectionProfile): string {
  switch (profile.ip_version) {
    case "v4":
      return "IPv4 preferred";
    case "v6":
      return "IPv6 preferred";
    case "both":
      return "Dual-stack";
  }
}

function runtimeIpLabel(endpoint: string | null, profile: ConnectionProfile): string {
  if (endpoint) {
    const firstHop = endpoint.split(">")[0].trim();
    if (firstHop.startsWith("[")) return "IPv6 selected";
    if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(firstHop)) return "IPv4 selected";
  }
  return configuredIpLabel(profile);
}

function maskLabel(profile: ConnectionProfile): string | null {
  if (!profile.masque_http2) return null;
  const mask = profile.masque_mask ?? (profile.fragment ? "legacy" : "off");
  switch (mask) {
    case "off":
      return "H2 mask off";
    case "legacy":
      return "Legacy H2 mask";
    case "clienthello":
      return "ClientHello mask";
    case "patterniha":
      return "Adaptive compatibility mask";
  }
}

function capacityLabel(downloadKbps: number, uploadKbps: number): string {
  const format = (kbps: number) =>
    kbps >= 1000 ? `${(kbps / 1000).toFixed(kbps >= 10_000 ? 0 : 1)} Mbps` : `${kbps} kbps`;
  return `↓ ${format(downloadKbps)} · ↑ ${format(uploadKbps)}`;
}

export function ConnectionDiagnostics() {
  const status = useConnectionStore((state) => state.status);
  const attemptId = useConnectionStore((state) => state.attemptId);
  const configuredProfile = useConnectionStore((state) => state.profile);
  const runtimePath = useConnectionStore((state) => state.runtimePath);
  const runtimePathAttemptId = useConnectionStore((state) => state.runtimePathAttemptId);
  const runtimeCapacity = useConnectionStore((state) => state.runtimeCapacity);
  const runtimeCapacityAttemptId = useConnectionStore((state) => state.runtimeCapacityAttemptId);
  const automaticAttempt = useAutomaticRuntimeStore((state) => state.attempt);
  const tunnelSelection = useSystemTunnelStore((state) => state.selection);
  const pathHealth = useTelemetryStore((state) => state.snapshot.path_health ?? "unknown");
  const qualityScore = useTelemetryStore((state) => state.snapshot.quality_score ?? 0);
  const qualityConfidence = useTelemetryStore((state) => state.snapshot.quality_confidence ?? 0);
  const telemetryCapacityComplete = useTelemetryStore(
    (state) => state.snapshot.capacity_probe_complete ?? false,
  );
  const telemetryDownload = useTelemetryStore((state) => state.snapshot.download_kbps ?? null);
  const telemetryUpload = useTelemetryStore((state) => state.snapshot.upload_kbps ?? null);
  const telemetryUploadLimited = useTelemetryStore((state) => state.snapshot.upload_limited ?? false);

  if (status.state === "Idle") return null;

  const activeAutomaticAttempt =
    automaticAttempt?.attemptId === attemptId ? automaticAttempt : null;
  const profile = activeAutomaticAttempt?.profile ?? configuredProfile;
  const path = runtimePathAttemptId === attemptId ? runtimePath : null;
  const runtimeAttemptCapacity =
    runtimeCapacityAttemptId === attemptId ? runtimeCapacity : null;
  const capacity = runtimeAttemptCapacity
    ? {
        downloadKbps: runtimeAttemptCapacity.downloadKbps,
        uploadKbps: runtimeAttemptCapacity.uploadKbps,
      }
    : telemetryCapacityComplete && telemetryDownload != null && telemetryUpload != null
      ? { downloadKbps: telemetryDownload, uploadKbps: telemetryUpload }
      : null;
  const uploadLimited = runtimeAttemptCapacity?.uploadLimited ?? telemetryUploadLimited;
  const transport = path?.transport ? path.transport.toUpperCase() : inferredTransport(profile);
  const mask = maskLabel(profile);
  const tunnel =
    status.state === "StartingTunnel" || status.state === "Tunneling"
      ? status.tunnel
      : tunnelSelection === "off"
        ? "Proxy only"
        : tunnelSelection === "native"
          ? "Native VPN"
          : "sing-box TUN";
  const progress = activeAutomaticAttempt
    ? `${activeAutomaticAttempt.index}/${activeAutomaticAttempt.total}`
    : null;

  return (
    <section className="rounded-2xl bg-white/[0.025] px-3.5 py-3 ring-1 ring-white/8">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Activity size={14} className="shrink-0 text-primary" />
          <span className="truncate text-xs font-medium text-foreground">
            {activeAutomaticAttempt?.label ?? "Connection details"}
          </span>
        </div>
        {progress && (
          <span className="shrink-0 rounded-full bg-primary/8 px-2 py-0.5 font-mono text-[10px] text-primary ring-1 ring-primary/15">
            Attempt {progress}
          </span>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5 font-mono text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded-lg bg-black/15 px-2 py-1 ring-1 ring-white/7">
          <Network size={10} /> {transport}
        </span>
        <span className="inline-flex items-center gap-1 rounded-lg bg-black/15 px-2 py-1 ring-1 ring-white/7">
          <Globe2 size={10} /> {runtimeIpLabel(path?.endpoint ?? null, profile)}
        </span>
        {mask && (
          <span className="rounded-lg bg-black/15 px-2 py-1 ring-1 ring-white/7">{mask}</span>
        )}
        <span className="inline-flex items-center gap-1 rounded-lg bg-black/15 px-2 py-1 ring-1 ring-white/7">
          <ShieldCheck size={10} /> {tunnel}
        </span>
        {path && (
          <span
            className="max-w-full truncate rounded-lg bg-black/15 px-2 py-1 ring-1 ring-white/7"
            title={path.endpoint}
          >
            {path.endpoint}
          </span>
        )}
        {pathHealth !== "unknown" && (
          <span className="rounded-lg bg-black/15 px-2 py-1 ring-1 ring-white/7">
            {pathHealth}
            {qualityConfidence >= 40 ? ` · ${qualityScore}/100` : ""}
          </span>
        )}
        {capacity && (
          <span className="inline-flex items-center gap-1 rounded-lg bg-black/15 px-2 py-1 ring-1 ring-white/7">
            <Gauge size={10} /> {capacityLabel(capacity.downloadKbps, capacity.uploadKbps)}
          </span>
        )}
        {uploadLimited && (
          <span className="rounded-lg bg-status-connecting/10 px-2 py-1 text-status-connecting ring-1 ring-status-connecting/20">
            Upload restricted
          </span>
        )}
      </div>
    </section>
  );
}
