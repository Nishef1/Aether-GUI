import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useConnectionStore } from "@/state/connectionStore"
import type { TunEngine } from "@/types/connection"

const LABELS: Record<TunEngine, string> = {
  singbox: "sing-box",
  xray: "Xray",
}

const DESCRIPTIONS: Record<TunEngine, string> = {
  singbox:
    "Recommended on Windows. strict_route and DNS hijacking keep system DNS on Aether's protected path and provide the most consistent resolver behavior.",
  xray:
    "Compatibility option. Xray can route plaintext DNS through Aether, but its DNS outbound cannot transparently replace browser DoH, DoT, or DoQ providers.",
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
