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
        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 rounded-xl border border-white/8 bg-surface-2/80 px-3 py-2.5 text-left outline-none transition-[border-color,background-color,box-shadow,transform] duration-200 ease-out hover:-translate-y-px hover:border-primary/35 hover:bg-surface-3/90 hover:shadow-[0_8px_24px_rgba(0,0,0,0.18)] focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=open]:border-primary/30 data-[state=open]:bg-primary/8 data-[state=open]:shadow-[inset_0_1px_0_color-mix(in_oklch,var(--color-primary)_18%,transparent)] motion-reduce:transform-none motion-reduce:transition-none">
          <span className="flex min-w-0 items-center gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary ring-1 ring-primary/20 transition-colors duration-200 group-hover:bg-primary/18 group-data-[state=open]:bg-primary/20">
              <Settings2 size={16} aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium leading-tight text-foreground">
                Advanced settings
              </span>
              <span className="mt-0.5 block truncate text-[10px] leading-tight text-muted-foreground">
                Protocol, routing, and reconnect options
              </span>
            </span>
          </span>

          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-black/18 text-muted-foreground ring-1 ring-white/8 transition-colors duration-200 group-hover:text-foreground group-data-[state=open]:bg-primary/14 group-data-[state=open]:text-primary">
            <ChevronDown
              size={15}
              aria-hidden="true"
              className="transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-data-[state=open]:rotate-180 motion-reduce:transition-none"
            />
          </span>
        </CollapsibleTrigger>

        <CollapsibleContent className="advanced-collapsible-content">
          <div className="pt-2.5">
            <div className="flex flex-col gap-4 rounded-xl border border-border/80 bg-surface-1/78 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
              <FieldRow
                label="Protocol"
                tooltip="MASQUE carries traffic over HTTP transports and may blend better with common web traffic. WireGuard is lighter and faster when its UDP path works. gool nests WireGuard sessions but does not guarantee better censorship resistance."
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
                tooltip="HTTP/3 uses QUIC over UDP and generally handles loss and parallel traffic better. HTTP/2 uses TLS over TCP and may connect where UDP or QUIC is disrupted, with potentially higher latency."
              >
                <MasqueTransportToggle />
              </FieldRow>
              <FieldRow
                label="Obfuscation"
                tooltip="Changes initial packet and timing patterns to reduce simple protocol fingerprinting. Heavier profiles add overhead and cannot make a connection invisible or overcome endpoint and IP blocking."
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
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
