import { AnimatePresence, motion, type Variants } from "motion/react"
import { AlertTriangle, Check, Loader2, Power } from "lucide-react"
import { cn } from "@/lib/utils"
import { useConnectionStore } from "@/state/connectionStore"
import { useWindowFocused } from "@/state/windowFocus"
import type { ConnectionStatus } from "@/types/connection"

type Phase = "idle" | "connecting" | "connected" | "error"

function phaseOf(status: ConnectionStatus): Phase {
  switch (status.state) {
    case "Launching":
    case "Connecting":
    case "StartingTunnel":
    case "Reconnecting":
    case "Disconnecting":
      return "connecting"
    case "Connected":
    case "Tunneling":
      return "connected"
    case "Error":
      return "error"
    default:
      return "idle"
  }
}

const SHAKE_VARIANTS: Variants = {
  rest: { x: 0 },
  error: {
    x: [0, -6, 6, -4, 4, 0],
    transition: { x: { duration: 0.4, ease: "easeInOut" } },
  },
}

const RING_SHADOW: Record<Phase, string> = {
  idle: "0 0 0 3px var(--color-status-idle)",
  connecting: "0 0 0 3px var(--color-status-connecting)",
  connected:
    "0 0 0 1px color-mix(in oklch, var(--color-status-connected) 40%, transparent)",
  error: "0 0 0 3px var(--color-status-error)",
}

const RING_ANIM: Record<Phase, string> = {
  idle: "anim-ring-breathe",
  connecting: "anim-ring-pulse-fast",
  connected: "anim-ring-pulse-slow",
  error: "",
}

const GLOW: Partial<Record<Phase, string>> = {
  connecting:
    "0 0 20px 3px color-mix(in oklch, var(--color-status-connecting) 50%, transparent)",
  connected: "0 0 32px 6px var(--color-status-connected)",
}

const ICONS: Record<Phase, typeof Power> = {
  idle: Power,
  connecting: Loader2,
  connected: Check,
  error: AlertTriangle,
}

const ARIA_LABEL: Record<Phase, string> = {
  idle: "Connect",
  connecting: "Cancel connecting",
  connected: "Disconnect",
  error: "Retry connection",
}

export function ConnectButton() {
  const status = useConnectionStore((s) => s.status)
  const connect = useConnectionStore((s) => s.connect)
  const disconnect = useConnectionStore((s) => s.disconnect)
  const preparingCores = useConnectionStore((s) => s.preparingCores)
  const focused = useWindowFocused()

  const phase = preparingCores ? "connecting" : phaseOf(status)
  const Icon = ICONS[phase]
  const playState = {
    animationPlayState: focused ? ("running" as const) : ("paused" as const),
  }

  const handleClick = () => {
    if (phase === "idle" || phase === "error") {
      void connect()
    } else {
      void disconnect()
    }
  }

  return (
    <motion.button
      type="button"
      aria-label={ARIA_LABEL[phase]}
      onClick={handleClick}
      disabled={status.state === "Disconnecting" || preparingCores}
      whileTap={{ scale: 0.97 }}
      animate={phase === "error" ? "error" : "rest"}
      variants={SHAKE_VARIANTS}
      className="relative flex size-40 items-center justify-center rounded-full text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-0 rounded-full bg-surface-2",
          RING_ANIM[phase]
        )}
        style={{
          boxShadow: RING_SHADOW[phase],
          transition: "box-shadow 0.15s ease",
          willChange: "transform, opacity",
          ...playState,
        }}
      />

      {GLOW[phase] && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 rounded-full",
            phase === "connecting" ? "anim-glow-fast" : "anim-glow-slow"
          )}
          style={{
            boxShadow: GLOW[phase],
            willChange: "transform, opacity",
            ...playState,
          }}
        />
      )}

      <AnimatePresence>
        {(phase === "connecting" || phase === "connected") && (
          <motion.span
            key={phase}
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full border-2"
            style={{
              borderColor:
                phase === "connected"
                  ? "var(--color-status-connected)"
                  : "var(--color-status-connecting)",
            }}
            initial={{ scale: 0.9, opacity: 0.55 }}
            animate={{ scale: phase === "connected" ? 2 : 1.7, opacity: 0 }}
            transition={{
              duration: phase === "connected" ? 0.9 : 0.7,
              ease: "easeOut",
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        <motion.span
          key={phase}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.1, ease: [0.4, 0, 0.2, 1] }}
          className="relative flex items-center justify-center"
        >
          <Icon
            size={48}
            strokeWidth={2}
            style={phase === "connecting" ? playState : undefined}
            className={
              phase === "connecting"
                ? "animate-spin text-status-connecting"
                : phase === "connected"
                  ? "text-status-connected"
                  : phase === "error"
                    ? "text-status-error"
                    : "text-status-idle"
            }
          />
        </motion.span>
      </AnimatePresence>
    </motion.button>
  )
}
