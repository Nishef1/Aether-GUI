import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useConnectionStore } from "@/state/connectionStore"
import type { TunEngine } from "@/types/connection"

const LABELS: Record<TunEngine, string> = {
  xray: "Xray",
  singbox: "sing-box",
}

const DESCRIPTIONS: Record<TunEngine, string> = {
  xray:
    "Recommended on Windows. Uses Xray's native Wintun inbound, applies interface DNS, and routes system traffic into Aether's protected SOCKS path.",
  singbox:
    "Compatibility fallback. The current 1.13 baseline can fail Windows DNS verification on some systems; use it only when Xray is incompatible.",
}

export function TunEngineToggle() {
  const status = useConnectionStore((state) => state.status)
  const mode = useConnectionStore((state) => state.profile.connection_mode)
  const engine = useConnectionStore((state) => state.profile.tun_engine)
  const setTunEngine = useConnectionStore((state) => state.setTunEngine)
  const locked = status.state !== "Idle" && status.state !== "Error"
  const proxyOnly = mode === "proxy"

  return (
    <ToggleGroup
      type="single"
      value={engine}
      onValueChange={(value) => {
        if (value) setTunEngine(value as TunEngine)
      }}
      disabled={locked || proxyOnly}
      className="w-full gap-0 rounded-full bg-black/20 p-1 ring-1 ring-white/10"
    >
      {(Object.keys(LABELS) as TunEngine[]).map((value) => (
        <Tooltip key={value}>
          <TooltipTrigger asChild>
            <span className="flex-1">
              <ToggleGroupItem
                value={value}
                size="sm"
                aria-label={LABELS[value]}
                className="w-full rounded-full text-muted-foreground transition-colors duration-75 data-[state=on]:bg-primary/85 data-[state=on]:text-primary-foreground"
              >
                {LABELS[value]}
              </ToggleGroupItem>
            </span>
          </TooltipTrigger>
          <TooltipContent>{DESCRIPTIONS[value]}</TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  )
}
