import { useEffect, useState } from "react";
import { Gauge, Globe2, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { CountryFlag } from "@/components/CountryFlag";
import { EXIT_RETRY_LIMIT, isPrivacyPreferredExit } from "@/lib/exitPolicy";
import { isAndroid } from "@/lib/platform";
import { useConnectionStore } from "@/state/connectionStore";
import { useExitPolicyStore } from "@/state/exitPolicyStore";
import { useTelemetryStore } from "@/state/telemetryStore";
import { useWindowFocused } from "@/state/windowFocus";

const DESKTOP_TEXT_TRANSITION = {
  initial: { y: 4, opacity: 0 },
  animate: { y: 0, opacity: 1 },
  exit: { y: -4, opacity: 0 },
  transition: { duration: 0.1, ease: [0.4, 0, 0.2, 1] as const },
};
const MOBILE_TEXT_TRANSITION = {
  initial: false as const,
  animate: { opacity: 1 },
  exit: { opacity: 1 },
  transition: { duration: 0 },
};
const TEXT_TRANSITION = isAndroid ? MOBILE_TEXT_TRANSITION : DESKTOP_TEXT_TRANSITION;
const BYTE_UNITS = ["KiB", "MiB", "GiB", "TiB"];

let regionNames: Intl.DisplayNames | null | undefined;

function getRegionNames(): Intl.DisplayNames | null {
  if (regionNames !== undefined) return regionNames;
  try {
    regionNames = new Intl.DisplayNames([navigator.language || "en"], { type: "region" });
  } catch {
    regionNames = null;
  }
  return regionNames;
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");

  useEffect(() => {
    const onVisibilityChange = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  return visible;
}

function useElapsed(
  sinceMs: number | null,
  active: boolean,
): { formatted: string; totalSeconds: number } {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (sinceMs == null || !active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active, sinceMs]);

  if (sinceMs == null) return { formatted: "", totalSeconds: 0 };
  const effectiveNow = active ? now : Math.max(now, sinceMs);
  const total = Math.max(0, Math.floor((effectiveNow - sinceMs) / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return { formatted: `${h}:${m}:${s}`, totalSeconds: total };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < BYTE_UNITS.length - 1);
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${BYTE_UNITS[unit]}`;
}

function formatKbps(kbps: number): string {
  if (kbps >= 1000) {
    const mbps = kbps / 1000;
    return `${mbps.toFixed(mbps >= 10 ? 0 : 1)} Mbps`;
  }
  return `${Math.max(1, Math.round(kbps))} kbps`;
}

function countryName(code: string): string {
  return getRegionNames()?.of(code) ?? code;
}

function ScanProgressBar({ percent, active }: { percent: number | null; active: boolean }) {
  const accessibility =
    percent == null
      ? { "aria-valuetext": "Searching for a healthy route" }
      : { "aria-valuenow": percent, "aria-valuetext": `${percent}% of the current search budget` };

  if (isAndroid) {
    return (
      <div
        role="progressbar"
        aria-label="Route discovery progress"
        aria-valuemin={0}
        aria-valuemax={100}
        {...accessibility}
        className="h-1 w-40 overflow-hidden rounded-full bg-surface-2"
      >
        {percent == null ? (
          <div
            className="android-scan-indeterminate h-full w-1/3 rounded-full bg-status-connecting"
            style={{ animationPlayState: active ? "running" : "paused" }}
          />
        ) : (
          <div
            className="h-full rounded-full bg-status-connecting transition-[width] duration-300 ease-out"
            style={{ width: `${percent}%` }}
          />
        )}
      </div>
    );
  }

  return (
    <div
      role="progressbar"
      aria-label="Route discovery progress"
      aria-valuemin={0}
      aria-valuemax={100}
      {...accessibility}
      className="h-1 w-40 overflow-hidden rounded-full bg-surface-2"
    >
      {percent == null ? (
        <motion.div
          className="h-full w-1/3 rounded-full bg-status-connecting"
          animate={active ? { x: ["-100%", "220%"] } : { x: "50%", opacity: 0.6 }}
          transition={
            active
              ? { duration: 1.1, repeat: Infinity, ease: "easeInOut" }
              : { duration: 0.3 }
          }
        />
      ) : (
        <motion.div
          className="h-full rounded-full bg-status-connecting"
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
      )}
    </div>
  );
}

function TunnelTraffic() {
  const receivedBytes = useTelemetryStore((state) => state.snapshot.received_bytes);
  const sentBytes = useTelemetryStore((state) => state.snapshot.sent_bytes);

  return (
    <span className="font-mono text-[10px] text-muted-foreground" aria-label="Tunnel traffic">
      ↓ {formatBytes(receivedBytes)} · ↑ {formatBytes(sentBytes)}
    </span>
  );
}

export function ConnectionStatusLine() {
  const status = useConnectionStore((state) => state.status);
  const scanBudgetSecs = useConnectionStore((state) => state.scanBudgetSecs);
  const publicIp = useTelemetryStore((state) => state.snapshot.public_ip);
  const countryCodeRaw = useTelemetryStore((state) => state.snapshot.country_code);
  const latencyMs = useTelemetryStore((state) => state.snapshot.latency_ms);
  const egressProbeComplete = useTelemetryStore((state) => state.snapshot.egress_probe_complete);
  const capacityProbeComplete = useTelemetryStore(
    (state) => state.snapshot.capacity_probe_complete ?? false,
  );
  const downloadKbps = useTelemetryStore((state) => state.snapshot.download_kbps ?? null);
  const uploadKbps = useTelemetryStore((state) => state.snapshot.upload_kbps ?? null);
  const uploadLimited = useTelemetryStore((state) => state.snapshot.upload_limited ?? false);
  const retryPrivacyExit = useTelemetryStore((state) => state.retryPrivacyExit);
  const exitPreference = useExitPolicyStore((state) => state.preference);
  const privacyRetryCount = useExitPolicyStore((state) => state.retryCount);
  const privacyRerolling = useExitPolicyStore((state) => state.rerolling);
  const privacyExhausted = useExitPolicyStore((state) => state.exhausted);
  const focused = useWindowFocused();
  const documentVisible = useDocumentVisible();
  const active = focused && documentVisible;

  const connectedAt =
    status.state === "Connected" ||
    status.state === "StartingTunnel" ||
    status.state === "Tunneling"
      ? status.connected_at_ms
      : null;
  const { formatted: elapsed } = useElapsed(connectedAt, active);
  const connectionReady = connectedAt != null;
  const stableConnected = status.state === "Connected" || status.state === "Tunneling";
  const systemTunnelError = status.state === "Error" && status.phase === "system-tunnel";
  const privilegeTunnelError =
    systemTunnelError &&
    /administrator|approval|uac|pkexec|polkit|permission|privilege/i.test(status.message);

  const countryCode = countryCodeRaw?.toUpperCase() ?? null;
  const privacyPreferred = isPrivacyPreferredExit(countryCode);
  const privacySearching =
    exitPreference === "privacy" &&
    privacyRetryCount > 0 &&
    !privacyPreferred &&
    !privacyExhausted;

  const [attemptStartedAt, setAttemptStartedAt] = useState<number | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect -- capture transition time */
  useEffect(() => {
    if (status.state === "Launching") setAttemptStartedAt(Date.now());
    else if (status.state === "Idle") setAttemptStartedAt(null);
  }, [status.state]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const isAttempting =
    status.state === "Launching" ||
    status.state === "Connecting" ||
    status.state === "AwaitingAccessCode";
  const { formatted: attemptElapsed, totalSeconds: attemptSeconds } = useElapsed(
    isAttempting ? attemptStartedAt : null,
    active,
  );
  const scanPercent =
    scanBudgetSecs != null
      ? Math.min(99, Math.round((attemptSeconds / scanBudgetSecs) * 100))
      : null;

  let primary: string;
  let secondary: string;
  switch (status.state) {
    case "Idle":
      primary = "Disconnected";
      secondary = "Click to connect";
      break;
    case "Launching":
      primary = privacySearching ? "Trying another exit…" : "Starting Aether…";
      secondary = privacySearching
        ? `Privacy retry ${privacyRetryCount} of ${EXIT_RETRY_LIMIT}`
        : "Preparing the transport core";
      break;
    case "Connecting":
      primary = privacySearching ? "Finding a privacy exit…" : "Finding a route…";
      secondary =
        scanPercent != null
          ? `Still searching · ${attemptElapsed} · ${scanPercent}%`
          : `Still searching · ${attemptElapsed}`;
      break;
    case "AwaitingAccessCode":
      primary = "Verification required";
      secondary = "Enter the one-time code sent by Cloudflare Access";
      break;
    case "Connected":
      primary = "Connected";
      secondary = elapsed;
      break;
    case "StartingTunnel":
      primary = "Starting system tunnel…";
      secondary = `Validating ${status.tunnel} · ${elapsed}`;
      break;
    case "Tunneling":
      primary = "Protected system-wide";
      secondary = elapsed;
      break;
    case "Reconnecting":
      primary = "Reconnecting…";
      secondary = `Attempt ${status.attempt} of ${status.max_attempts}`;
      break;
    case "Disconnecting":
      primary = privacyRerolling ? "Switching exit…" : "Disconnecting…";
      secondary = privacyRerolling ? "Keeping the retry bounded to protect battery" : "";
      break;
    case "Error":
      primary = status.phase === "system-tunnel" ? "Device protection failed" : "Connection failed";
      secondary = status.message;
      break;
  }

  const hasEgressInfo = Boolean(publicIp || countryCodeRaw || latencyMs != null);
  const hasCapacityInfo =
    capacityProbeComplete && downloadKbps != null && uploadKbps != null;
  const canRetryPrivacy =
    stableConnected &&
    exitPreference === "privacy" &&
    egressProbeComplete &&
    !privacyPreferred &&
    !privacyRerolling &&
    (privacyExhausted || !countryCode);

  return (
    <div className="flex min-h-[60px] flex-col items-center gap-2 text-center">
      <span className="sr-only" role={status.state === "Error" ? "alert" : "status"}>
        {status.state === "Error" ? `${primary}. ${secondary}` : primary}
      </span>

      <AnimatePresence mode="wait">
        <motion.span
          key={status.state}
          className="block text-base font-medium text-foreground"
          {...TEXT_TRANSITION}
        >
          {primary}
        </motion.span>
      </AnimatePresence>
      <AnimatePresence mode="wait">
        <motion.span
          key={`${status.state}-${secondary}`}
          className={`block min-h-5 max-w-xs font-mono text-xs text-muted-foreground ${
            status.state === "Error"
              ? "line-clamp-3 whitespace-normal leading-relaxed"
              : "truncate"
          }`}
          {...TEXT_TRANSITION}
        >
          {secondary}
        </motion.span>
      </AnimatePresence>

      {systemTunnelError && (
        <span className="max-w-xs rounded-xl bg-status-error/5 px-3 py-2 text-[11px] leading-4 text-muted-foreground ring-1 ring-status-error/15">
          {privilegeTunnelError
            ? "Full-device protection remains enabled. Retry after granting administrator access; on macOS, launch Aether-GUI with administrator privileges."
            : "Aether was stopped because the full-device tunnel could not be verified. Full-device protection remains enabled; resolve the tunnel error and retry."}
        </span>
      )}

      {(status.state === "Connecting" || status.state === "Launching") && (
        <ScanProgressBar percent={scanPercent} active={active} />
      )}

      {connectionReady && !egressProbeComplete && (
        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
          <Globe2 size={11} aria-hidden="true" />
          Checking exit IP…
        </span>
      )}
      {connectionReady && egressProbeComplete && !hasEgressInfo && (
        <span className="font-mono text-[10px] text-muted-foreground">
          Exit information unavailable
        </span>
      )}
      {connectionReady && hasEgressInfo && (
        <div
          className="flex max-w-sm flex-wrap items-center justify-center gap-x-2 gap-y-1 font-mono text-[10px] text-muted-foreground"
          aria-label="Tunnel egress information"
        >
          {countryCode && (
            <span
              className="inline-flex items-center gap-1.5"
              title="Approximate geolocation of the tunnel egress IP; WARP does not guarantee an exit country"
            >
              <CountryFlag code={countryCode} className="h-[13px] w-[18px]" />
              Approx. {countryName(countryCode)}
            </span>
          )}
          {publicIp && <span title="Verified public tunnel egress IP">{publicIp}</span>}
          {latencyMs != null && (
            <span
              className="inline-flex items-center gap-1"
              title="End-to-end latency through the tunnel"
            >
              <Gauge size={11} aria-hidden="true" />
              {latencyMs} ms
            </span>
          )}
          {hasCapacityInfo && !uploadLimited && (
            <span title="Small bounded path sample; not a continuous speed test">
              ↓ {formatKbps(downloadKbps)} · ↑ {formatKbps(uploadKbps)}
            </span>
          )}
        </div>
      )}

      {connectionReady && hasCapacityInfo && uploadLimited && (
        <span
          className="inline-flex items-center gap-1.5 rounded-full bg-status-connecting/8 px-2.5 py-1 font-mono text-[10px] text-status-connecting ring-1 ring-status-connecting/20"
          title="A small bounded path sample found severe upstream asymmetry; the connection remains usable"
        >
          <TriangleAlert size={11} aria-hidden="true" />
          Upstream constrained · ↑ {formatKbps(uploadKbps)}
        </span>
      )}

      {connectionReady && exitPreference === "privacy" && egressProbeComplete && (
        <div className="flex max-w-xs flex-col items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] ring-1 ${
              privacyPreferred
                ? "bg-status-connected/8 text-status-connected ring-status-connected/20"
                : privacyExhausted
                  ? "bg-status-connecting/8 text-status-connecting ring-status-connecting/20"
                  : "bg-white/5 text-muted-foreground ring-white/10"
            }`}
          >
            {privacyPreferred ? (
              <ShieldCheck size={11} aria-hidden="true" />
            ) : privacySearching ? (
              <RefreshCw
                size={11}
                className={isAndroid ? "android-connect-spin" : "animate-spin"}
                style={{ animationPlayState: active ? "running" : "paused" }}
                aria-hidden="true"
              />
            ) : (
              <TriangleAlert size={11} aria-hidden="true" />
            )}
            {privacyPreferred
              ? "Privacy exit accepted"
              : !countryCode
                ? "Exit country could not be verified; connection kept"
                : privacyExhausted
                  ? `Preferred exit unavailable after ${EXIT_RETRY_LIMIT} automatic retries; current connection kept`
                  : `Current exit is outside the privacy pool · retry ${privacyRetryCount}/${EXIT_RETRY_LIMIT}`}
          </span>

          {canRetryPrivacy && (
            <button
              type="button"
              onClick={retryPrivacyExit}
              className="min-h-11 rounded-full bg-white/5 px-4 text-[11px] font-medium text-foreground ring-1 ring-white/10 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Try another exit
            </button>
          )}
        </div>
      )}

      {status.state === "Tunneling" && <TunnelTraffic />}
    </div>
  );
}
