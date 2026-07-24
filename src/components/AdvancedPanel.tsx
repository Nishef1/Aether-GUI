import { useState, type ReactNode } from "react"
import { ChevronDown, Info, Settings2 } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Switch } from "@/components/ui/switch"
import { ProtocolSelect } from "@/components/ProtocolSelect"
import { ScanModeToggle } from "@/components/ScanModeToggle"
import { IpVersionToggle } from "@/components/IpVersionToggle"
import { MasqueTransportToggle } from "@/components/MasqueTransportToggle"
import { NoizeProfileToggle } from "@/components/NoizeProfileToggle"
import { BindAddressField } from "@/components/BindAddressField"
import { TunEngineToggle } from "@/components/TunEngineToggle"
import { useConnectionStore } from "@/state/connectionStore"

function FieldRow({
  label,
  tooltip,
  children,
}: {
  label: string
  tooltip?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {tooltip && (
          <Tooltip>
            <TooltipTrigger aria-label={`About ${label}`}>
              <Info size={12} />
            </TooltipTrigger>
            <TooltipContent>{tooltip}</TooltipContent>
          </Tooltip>
        )}
      </div>
      {children}
    </div>
  )
}

export function AdvancedPanel() {
  const status = useConnectionStore((state) => state.status)
  const mode = useConnectionStore((state) => state.profile.connection_mode)
  const quickReconnect = useConnectionStore(
    (state) => state.profile.quick_reconnect
  )
  const profileSaveError = useConnectionStore((state) => state.profileSaveError)
  const setQuickReconnect = useConnectionStore(
    (state) => state.setQuickReconnect
  )
  const [open, setOpen] = useState(false)
  const locked = status.state !== "Idle" && status.state !== "Error"

  return (
    <div className="w-full max-w-sm">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary">
          <Settings2 size={14} />
          Advanced
          <ChevronDown
            size={14}
            className="transition-transform duration-150 data-[state=open]:rotate-180"
            data-state={open ? "open" : "closed"}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-1 data-[state=open]:duration-150 data-[state=open]:[animation-timing-function:cubic-bezier(0.16,1,0.3,1)] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-100">
          <div className="flex flex-col gap-4 pb-2">
            <FieldRow
              label="Protocol"
              tooltip="MASQUE disguises traffic as normal HTTPS — best against strict censorship. WireGuard is lighter and faster. gool nests two WireGuard tunnels for extra security at a speed cost."
            >
              <ProtocolSelect />
            </FieldRow>
            <FieldRow label="Scan Mode">
              <ScanModeToggle />
            </FieldRow>
            <FieldRow
              label="IP Version"
              tooltip="Which address families to search for working routes. IPv4 is the safest default on most networks."
            >
              <IpVersionToggle />
            </FieldRow>
            <FieldRow
              label="MASQUE Transport"
              tooltip="HTTP/3 uses QUIC and generally handles loss and parallel traffic better. HTTP/2 looks like ordinary HTTPS and can connect where UDP is blocked, but may be slower on higher-latency links."
            >
              <MasqueTransportToggle />
            </FieldRow>
            <FieldRow
              label="Obfuscation"
              tooltip="Disguises the handshake so DPI can't fingerprint the protocol. Heavier profiles send more decoy traffic — try escalating if the default doesn't connect. Options change based on the selected protocol."
            >
              <NoizeProfileToggle />
            </FieldRow>

            {mode !== "proxy" && (
              <FieldRow
                label="System TUN engine"
                tooltip="Xray is the recommended Windows system-routing layer. sing-box remains available as a compatibility fallback. Both send traffic into Aether's local SOCKS tunnel."
              >
                <TunEngineToggle />
              </FieldRow>
            )}

            {mode !== "tunnel" && (
              <FieldRow
                label="SOCKS5 Proxy"
                tooltip="The local SOCKS5 endpoint exposed for apps in Proxy and Both modes. It is always restricted to loopback because the core proxy has no authentication."
              >
                <BindAddressField />
              </FieldRow>
            )}

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                Quick reconnect
                <Tooltip>
                  <TooltipTrigger aria-label="About Quick reconnect">
                    <Info size={12} />
                  </TooltipTrigger>
                  <TooltipContent>
                    Remembers the last gateway that worked and re-tests it first on the next
                    connect, skipping the full scan when it still works. Turn off to always scan
                    fresh.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Switch
                checked={quickReconnect}
                onCheckedChange={setQuickReconnect}
                disabled={locked}
                aria-label="Quick reconnect"
              />
            </div>

            {profileSaveError && (
              <p className="text-[10px] leading-relaxed text-destructive" role="status">
                Could not save settings: {profileSaveError}
              </p>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
