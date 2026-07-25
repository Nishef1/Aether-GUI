import { useEffect, useState } from "react"
import { Gauge, Globe2 } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useConnectionStore } from "@/state/connectionStore"
import { useTelemetryStore } from "@/state/telemetryStore"

const TEXT_TRANSITION = {
  initial: { y: 4, opacity: 0 },
  animate: { y: 0, opacity: 1 },
  exit: { y: -4, opacity: 0 },
  transition: { duration: 0.1, ease: [0.4, 0, 0.2, 1] as const },
}

const BYTE_UNITS = ["KiB", "MiB", "GiB", "TiB"]

function formatElapsed(sinceMs: number, nowMs: number): string {
  const total = Math.max(0, Math.floor((nowMs - sinceMs) / 1000))
  const h = String(Math.floor(total / 3600)).padStart(2, "0")
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0")
  const s = String(total % 60).padStart(2, "0")
  return `${h}:${m}:${s}`
}

function useElapsed(sinceMs: number | null): {
  formatted: string
  totalSeconds: number
} {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (sinceMs == null) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [sinceMs])
  if (sinceMs == null) return { formatted: "", totalSeconds: 0 }
  const totalSeconds = Math.max(0, Math.floor((now - sinceMs) / 1000))
  return {
    formatted: formatElapsed(sinceMs, now),
    totalSeconds,
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  let value = bytes
  let unit = -1
  do {
    value /= 1024
    unit += 1
  } while (value >= 1024 && unit < BYTE_UNITS.length - 1)
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${BYTE_UNITS[unit]}`
}

function countryFlag(code: string): string {
  const normalized = code.toUpperCase()
  if (!/^[A-Z]{2}$/.test(normalized)) return "🌐"
  return String.fromCodePoint(
    ...normalized.split("").map((character) => 127397 + character.charCodeAt(0))
  )
}

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code
  } catch {
    return code
  }
}

function ScanProgressBar({ percent }: { percent: number | null }) {
  return (
    <div className="h-1 w-40 overflow-hidden rounded-full bg-surface-2">
      {percent == null ? (
        <div
          data-runtime-animation="active"
          className="anim-scan-route h-full w-1/3 rounded-full bg-status-connecting"
        />
      ) : (
        <motion.div
          className="h-full rounded-full bg-status-connecting"
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
      )}
    </div>
  )
}

export function ConnectionStatusLine() {
  const status = useConnectionStore((state) => state.status)
  const scanBudgetSecs = useConnectionStore((state) => state.scanBudgetSecs)
  const preparingCores = useConnectionStore((state) => state.preparingCores)
  const telemetry = useTelemetryStore((state) => state.snapshot)
  const tunEnabled = useConnectionStore(
    (state) => state.profile.connection_mode !== "proxy"
  )
  const connectedAt =
    status.state === "Connected" || status.state === "Tunneling"
      ? status.connected_at_ms
      : null
  const telemetryClock =
    connectedAt == null
      ? 0
      : Math.max(connectedAt, telemetry.sampled_at_ms || connectedAt)
  const elapsed =
    connectedAt == null ? "" : formatElapsed(connectedAt, telemetryClock)
  const connectionReady =
    status.state === "Connected" || status.state === "Tunneling"

  const [attemptStartedAt, setAttemptStartedAt] = useState<number | null>(null)
  /* eslint-disable react-hooks/set-state-in-effect -- capture transition time */
  useEffect(() => {
    if (status.state === "Launching") setAttemptStartedAt(Date.now())
    else if (status.state === "Idle") setAttemptStartedAt(null)
  }, [status.state])
  /* eslint-enable react-hooks/set-state-in-effect */

  const isAttempting =
    status.state === "Launching" || status.state === "Connecting"
  const { formatted: attemptElapsed, totalSeconds: attemptSeconds } =
    useElapsed(isAttempting ? attemptStartedAt : null)
  const scanPercent =
    scanBudgetSecs != null
      ? Math.min(99, Math.round((attemptSeconds / scanBudgetSecs) * 100))
      : null

  let primary: string
  let secondary: string

  if (preparingCores) {
    primary = "Preparing cores…"
    secondary = "Checking installed versions and available updates"
  } else
    switch (status.state) {
      case "Idle":
        primary = "Disconnected"
        secondary = "Click to connect"
        break
      case "Launching":
        primary = "Starting Aether…"
        secondary = "Preparing the tunnel core"
        break
      case "Connecting":
        primary = "Finding a route…"
        secondary =
          scanPercent != null
            ? `Still searching · ${attemptElapsed} · ${scanPercent}%`
            : `Still searching · ${attemptElapsed}`
        break
      case "StartingTunnel":
        primary = "Starting system tunnel…"
        secondary = "Verifying that all system traffic is protected"
        break
      case "Reconnecting":
        primary = "Reconnecting…"
        secondary = `Attempt ${status.attempt} of ${status.max_attempts}`
        break
      case "Connected":
        primary = tunEnabled ? "Starting system tunnel…" : "Connected"
        secondary = tunEnabled
          ? "Aether proxy is ready · verifying TUN data path"
          : elapsed
        break
      case "Tunneling":
        primary = "Protected system-wide"
        secondary = elapsed
        break
      case "Disconnecting":
        primary = "Disconnecting…"
        secondary = ""
        break
      case "Error":
        primary = "Connection failed"
        secondary = status.message
        break
    }

  const hasEgressInfo = Boolean(
    telemetry.public_ip || telemetry.country_code || telemetry.latency_ms != null
  )
  const country = telemetry.country_code
    ? `${countryFlag(telemetry.country_code)} ${countryName(telemetry.country_code)}`
    : null

  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <AnimatePresence mode="wait">
        <motion.span
          key={status.state}
          aria-live="polite"
          aria-atomic="true"
          className="block text-base font-medium text-foreground"
          {...TEXT_TRANSITION}
        >
          {primary}
        </motion.span>
      </AnimatePresence>
      <AnimatePresence mode="wait">
        <motion.span
          key={status.state}
          className="block min-h-5 max-w-xs truncate font-mono text-xs text-muted-foreground"
          {...TEXT_TRANSITION}
        >
          {secondary}
        </motion.span>
      </AnimatePresence>
      {status.state === "Connecting" && (
        <ScanProgressBar percent={scanPercent} />
      )}
      {connectionReady && !telemetry.egress_probe_complete && (
        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
          <Globe2 size={11} aria-hidden="true" />
          Checking exit IP…
        </span>
      )}
      {connectionReady && telemetry.egress_probe_complete && !hasEgressInfo && (
        <span className="font-mono text-[10px] text-muted-foreground">
          Exit information unavailable
        </span>
      )}
      {connectionReady && hasEgressInfo && (
        <div
          className="flex max-w-sm flex-wrap items-center justify-center gap-x-2 gap-y-1 font-mono text-[10px] text-muted-foreground"
          aria-label="Tunnel exit information"
        >
          {country && (
            <span className="inline-flex items-center gap-1" title="Tunnel exit country">
              <Globe2 size={11} aria-hidden="true" />
              {country}
            </span>
          )}
          {telemetry.public_ip && (
            <span title="Public tunnel exit IP">{telemetry.public_ip}</span>
          )}
          {telemetry.latency_ms != null && (
            <span
              className="inline-flex items-center gap-1"
              title="End-to-end latency through the tunnel to Cloudflare"
            >
              <Gauge size={11} aria-hidden="true" />
              {telemetry.latency_ms} ms
            </span>
          )}
        </div>
      )}
      {status.state === "Tunneling" && (
        <span
          className="font-mono text-[10px] text-muted-foreground"
          aria-label="Tunnel traffic"
        >
          ↓ {formatBytes(telemetry.received_bytes)} · ↑{" "}
          {formatBytes(telemetry.sent_bytes)}
        </span>
      )}
    </div>
  )
}
