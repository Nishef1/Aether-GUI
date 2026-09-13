import { Activity, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAutomaticRuntimeStore } from "@/state/automaticRuntimeStore";
import { useConnectionStore } from "@/state/connectionStore";
import { useTelemetryStore } from "@/state/telemetryStore";
import type { ConnectionProfile, PathHealth } from "@/types/connection";

function inferredTransport(profile: ConnectionProfile): string {
  switch (profile.protocol) {
    case "masque":
      return profile.masque_http2 ? "H2" : "H3";
    case "wireguard":
      return "WireGuard";
    case "gool":
      return "Warp-in-Warp";
    case "auto":
      return "Automatic";
  }
}

function runtimeTransportLabel(transport: string | null, profile: ConnectionProfile): string {
  switch (transport) {
    case "h2":
      return "H2";
    case "h3":
      return "H3";
    case "wg":
      return "WireGuard";
    case "gool":
      return "Warp-in-Warp";
    default:
      return inferredTransport(profile);
  }
}

function configuredIpLabel(profile: ConnectionProfile): string {
  switch (profile.ip_version) {
    case "v4":
      return "IPv4";
    case "v6":
      return "IPv6";
    case "both":
      return "Dual-stack";
  }
}

function runtimeIpLabel(endpoint: string | null, profile: ConnectionProfile): string {
  if (endpoint) {
    const firstHop = endpoint.split(">")[0].trim();
    if (firstHop.startsWith("[")) return "IPv6";
    if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(firstHop)) return "IPv4";
  }
  return configuredIpLabel(profile);
}

function healthPresentation(health: PathHealth): { label: string; className: string } {
  switch (health) {
    case "healthy":
      return {
        label: "Healthy",
        className: "bg-status-connected/8 text-status-connected ring-status-connected/20",
      };
    case "suspect":
      return {
        label: "Degraded",
        className: "bg-status-connecting/8 text-status-connecting ring-status-connecting/20",
      };
    case "failed":
      return {
        label: "Failed",
        className: "bg-status-error/8 text-status-error ring-status-error/20",
      };
    case "unknown":
      return { label: "Protected", className: "bg-black/15 text-muted-foreground ring-white/7" };
  }
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
  const pathHealth = useTelemetryStore((state) => state.snapshot.path_health ?? "unknown");
  const telemetryUploadLimited = useTelemetryStore((state) => state.snapshot.upload_limited ?? false);

  const stable = status.state === "Connected" || status.state === "Tunneling";
  if (!stable) return null;

  const activeAutomaticAttempt = automaticAttempt?.attemptId === attemptId ? automaticAttempt : null;
  const profile = activeAutomaticAttempt?.profile ?? configuredProfile;
  const path = runtimePathAttemptId === attemptId ? runtimePath : null;
  const runtimeAttemptCapacity = runtimeCapacityAttemptId === attemptId ? runtimeCapacity : null;
  const uploadLimited = runtimeAttemptCapacity?.uploadLimited ?? telemetryUploadLimited;
  const transport = runtimeTransportLabel(path?.transport ?? null, profile);
  const ipFamily = runtimeIpLabel(path?.endpoint ?? null, profile);
  const health = healthPresentation(pathHealth);

  return (
    <section
      className="rounded-2xl bg-white/[0.025] px-3.5 py-2.5 ring-1 ring-white/8"
      aria-label="Live connection details"
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Activity size={14} className="shrink-0 text-primary" aria-hidden="true" />
          <span className="truncate text-xs font-medium text-foreground">
            {transport} <span className="text-muted-foreground">· {ipFamily}</span>
          </span>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] ring-1",
            health.className,
          )}
        >
          <ShieldCheck size={10} aria-hidden="true" />
          {health.label}
        </span>
      </div>
      {uploadLimited && (
        <p className="mt-2 text-[10px] text-status-connecting">Upload is currently restricted.</p>
      )}
    </section>
  );
}
