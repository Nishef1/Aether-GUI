import { AnimatePresence, motion, type Variants } from "motion/react";
import { AlertTriangle, Check, Loader2, Power } from "lucide-react";
import { cancelAutomaticConnect, connectWithAutomaticPolicy } from "@/lib/autoConnect";
import { cn } from "@/lib/utils";
import { isAndroid } from "@/lib/platform";
import { useConnectionStore } from "@/state/connectionStore";
import { useExitPolicyStore } from "@/state/exitPolicyStore";
import { useWindowFocused } from "@/state/windowFocus";
import type { ConnectionStatus } from "@/types/connection";

type Phase = "idle" | "connecting" | "connected" | "error";

function phaseOf(status: ConnectionStatus): Phase {
  switch (status.state) {
    case "Launching":
    case "Connecting":
    case "AwaitingAccessCode":
    case "StartingTunnel":
    case "Reconnecting":
    case "Disconnecting":
      return "connecting";
    case "Connected":
    case "Tunneling":
      return "connected";
    case "Error":
      return "error";
    default:
      return "idle";
  }
}

const SHAKE_VARIANTS: Variants = {
  rest: { x: 0 },
  error: {
    x: [0, -5, 5, -3, 3, 0],
    transition: { x: { duration: 0.36, ease: "easeInOut" } },
  },
};

const STATUS_COLOR: Record<Phase, string> = {
  idle: "var(--color-status-idle)",
  connecting: "var(--color-status-connecting)",
  connected: "var(--color-status-connected)",
  error: "var(--color-status-error)",
};

const ICONS: Record<Phase, typeof Power> = {
  idle: Power,
  connecting: Loader2,
  connected: Check,
  error: AlertTriangle,
};

const ARIA_LABEL: Record<Phase, string> = {
  idle: "Connect",
  connecting: "Cancel connection attempt",
  connected: "Disconnect",
  error: "Retry connection",
};

export function ConnectButton() {
  const status = useConnectionStore((state) => state.status);
  const disconnect = useConnectionStore((state) => state.disconnect);
  const beginManualAttempt = useExitPolicyStore((state) => state.beginManualAttempt);
  const cancelAutomation = useExitPolicyStore((state) => state.cancelAutomation);
  const focused = useWindowFocused();
  const phase = phaseOf(status);
  const Icon = ICONS[phase];
  const color = STATUS_COLOR[phase];
  const animationPlayState = focused ? ("running" as const) : ("paused" as const);
  const disconnecting = status.state === "Disconnecting";
  const ariaLabel = disconnecting ? "Disconnecting" : ARIA_LABEL[phase];

  const handleClick = () => {
    if (phase === "idle" || phase === "error") {
      beginManualAttempt();
      void connectWithAutomaticPolicy();
    } else {
      cancelAutomaticConnect();
      cancelAutomation();
      void disconnect();
    }
  };

  return (
    <motion.button
      type="button"
      aria-label={ariaLabel}
      aria-busy={phase === "connecting"}
      onClick={handleClick}
      disabled={disconnecting}
      whileTap={disconnecting ? undefined : { scale: 0.965 }}
      animate={phase === "error" ? "error" : "rest"}
      variants={SHAKE_VARIANTS}
      className={cn(
        "connect-orb relative grid shrink-0 place-items-center rounded-full outline-none",
        "size-[9.25rem] sm:size-36",
        isAndroid && "mt-3",
        "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-background",
        "disabled:cursor-wait",
      )}
    >
      <span
        aria-hidden
        className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_35%_28%,rgba(255,255,255,0.14),transparent_38%),linear-gradient(145deg,var(--color-surface-2),var(--color-surface-1))] shadow-[0_20px_52px_rgba(0,0,0,0.42)] ring-1 ring-white/12"
      />
      <span
        aria-hidden
        className={cn(
          "absolute inset-[-3px] rounded-full border",
          phase === "connecting" && !isAndroid && "anim-ring-pulse-fast",
          phase === "connected" && !isAndroid && "anim-ring-pulse-slow",
          phase === "idle" && !isAndroid && "anim-ring-breathe",
          phase === "connecting" && isAndroid && "android-connect-ring",
          phase === "connected" && isAndroid && "android-connected-ring",
        )}
        style={{
          borderColor: color,
          boxShadow:
            phase === "connected"
              ? `0 0 34px color-mix(in oklch, ${color} 32%, transparent)`
              : phase === "connecting"
                ? `0 0 22px color-mix(in oklch, ${color} 28%, transparent)`
                : undefined,
          animationPlayState,
        }}
      />

      {!isAndroid && (
        <AnimatePresence>
          {(phase === "connecting" || phase === "connected") && (
            <motion.span
              key={`${phase}-ripple`}
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-full border"
              style={{ borderColor: color }}
              initial={{ scale: 0.96, opacity: 0.35 }}
              animate={{ scale: phase === "connected" ? 1.55 : 1.35, opacity: 0 }}
              transition={{ duration: 0.85, ease: "easeOut" }}
            />
          )}
        </AnimatePresence>
      )}

      {isAndroid && phase === "connecting" && (
        <span
          aria-hidden
          className="android-connect-ripple pointer-events-none absolute inset-1 rounded-full border"
          style={{ borderColor: color, animationPlayState }}
        />
      )}

      <AnimatePresence mode="wait">
        <motion.span
          key={phase}
          initial={isAndroid ? false : { opacity: 0, scale: 0.88 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={isAndroid ? undefined : { opacity: 0, scale: 0.88 }}
          transition={{ duration: isAndroid ? 0 : 0.12 }}
          className="relative grid place-items-center"
        >
          <Icon
            size={46}
            strokeWidth={2}
            style={{ animationPlayState }}
            aria-hidden="true"
            className={cn(
              phase === "connecting" && !isAndroid && "animate-spin",
              phase === "connecting" && isAndroid && "android-connect-spin",
              phase === "connecting" && "text-status-connecting",
              phase === "connected" && "text-status-connected",
              phase === "error" && "text-status-error",
              phase === "idle" && "text-status-idle",
            )}
          />
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}
