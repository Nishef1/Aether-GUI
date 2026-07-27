import { Globe2, Layers3, Network } from "lucide-react"
import { useConnectionStore } from "@/state/connectionStore"
import type { ConnectionMode } from "@/types/connection"

const MODES: Array<{
  value: ConnectionMode
  label: string
  icon: typeof Network
  title: string
}> = [
  {
    value: "proxy",
    label: "Proxy",
    icon: Network,
    title: "Local SOCKS5 proxy",
  },
  {
    value: "tunnel",
    label: "Tunnel",
    icon: Globe2,
    title: "System-wide VPN tunnel",
  },
  {
    value: "both",
    label: "Both",
    icon: Layers3,
    title: "System tunnel and local SOCKS5 proxy",
  },
]

export function ConnectionModeToggle() {
  const mode = useConnectionStore((state) => state.profile.connection_mode)
  const setMode = useConnectionStore((state) => state.setConnectionMode)
  const status = useConnectionStore((state) => state.status)
  const locked = status.state !== "Idle" && status.state !== "Error"

  return (
    <div className="w-full max-w-sm" aria-label="Connection mode">
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface-2/70 p-1 ring-1 ring-white/8">
        {MODES.map(({ value, label, icon: Icon, title }) => {
          const selected = mode === value
          return (
            <button
              key={value}
              type="button"
              disabled={locked}
              aria-pressed={selected}
              title={title}
              onClick={() => void setMode(value)}
              className={`flex min-w-0 items-center justify-center gap-2 rounded-lg px-2 py-2.5 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60 ${
                selected
                  ? "bg-background text-foreground shadow-sm ring-1 ring-white/10"
                  : "text-muted-foreground hover:bg-background/50 hover:text-foreground"
              }`}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate text-xs font-medium">{label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
