import { Activity, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAutomaticRuntimeStore } from "@/state/automaticRuntimeStore";
import { useConnectionStore } from "@/state/connectionStore";
import { useTelemetryStore } from "@/state/telemetryStore";
import type { ConnectionProfile, PathHealth } from "@/types/connection";

function configuredTransport(profile: ConnectionProfile): string {
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

function runtimeTransportLabel(transport: string | null): string | null {
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
      return null;
  }
}

type IpFamily = "IPv4" | "IPv6";

function ipFamilyFromHost(value: string | null): IpFamily | null {
  if (!value) return null;
  const host = value.trim();
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return "IPv4";
  if (host.includes(":")) return "IPv6";
  return null;
}

function endpointIpFamily(endpoint: string | null): IpFamily | null {
  if (!endpoint) return null;
  const firstHop = endpoint.split(">")[0]?.trim() ?? "";
  if (!firstHop) return null;

  if (firstHop.startsWith("[")) {
    const closing = firstHop.indexOf("]");
    return closing > 1 ? "IPv6" : null;
  }

  const ipv4WithOptionalPort = firstHop.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/);
  if (ipv4WithOptionalPort) return "IPv4";

  const colonCount = [...firstHop].filter((character) => character === ":").length;
  return colonCount >= 2 ? "IPv6" : null;
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
  const publicIp = useTelemetryStore((state) => state.snapshot.public_ip ?? null);
  const telemetryUploadLimited = useTelemetryStore((state) => state.snapshot.upload_limited ?? false);

  const stable = status.state === "Connected" || status.state === "Tunneling";
  if (!stable) return null;

  const activeAutomaticAttempt = automaticAttempt?.attemptId === attemptId ? automaticAttempt : null;
  const profile = activeAutomaticAttempt?.profile ?? configuredProfile;
  const path = runtimePathAttemptId === attemptId ? runtimePath : null;
  const runtimeAttemptCapacity = runtimeCapacityAttemptId === attemptId ? runtimeCapacity : null;
  const uploadLimited = runtimeAttemptCapacity?.uploadLimited ?? telemetryUploadLimited;
  const runtimeTransport = runtimeTransportLabel(path?.transport ?? null);
  const transport = runtimeTransport ?? `Configured ${configuredTransport(profile)}`;
  const edgeFamily = endpointIpFamily(path?.endpoint ?? null);
  const exitFamily = ipFamilyFromHost(publicIp);
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
            {transport}
            <span className="text-muted-foreground">
              {edgeFamily ? ` · Edge ${edgeFamily}` : " · Edge family pending"}
            </span>
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

      {(publicIp || exitFamily) && (
        <p className="mt-1.5 break-all font-mono text-[10px] leading-4 text-muted-foreground">
          {exitFamily ? `Exit ${exitFamily}` : "Exit IP"}
          {publicIp ? ` · ${publicIp}` : ""}
        </p>
      )}

      {uploadLimited && (
        <p className="mt-2 text-[10px] text-status-connecting">Upload is currently restricted.</p>
      )}
    </section>
  );
}
