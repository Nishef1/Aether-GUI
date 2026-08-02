import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Info, Settings2 } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { ProtocolSelect } from "@/components/ProtocolSelect";
import { ScanModeToggle } from "@/components/ScanModeToggle";
import { IpVersionToggle } from "@/components/IpVersionToggle";
import { MasqueTransportToggle } from "@/components/MasqueTransportToggle";
import { NoizeProfileToggle } from "@/components/NoizeProfileToggle";
import { BindAddressField } from "@/components/BindAddressField";
import { ZeroTrustSettings } from "@/components/ZeroTrustSettings";
import { RoutingSettings } from "@/components/RoutingSettings";
import { SystemTunnelToggle } from "@/components/SystemTunnelToggle";
import { CoreAdvancedSettings } from "@/components/CoreAdvancedSettings";
import { isAndroid } from "@/lib/platform";
import { useConnectionStore } from "@/state/connectionStore";

function FieldRow({
  label,
  tooltip,
  children,
}: {
  label: string;
  tooltip?: string;
  children: ReactNode;
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
  );
}

export function AdvancedPanel() {
  const logs = useConnectionStore((state) => state.logs);
  const status = useConnectionStore((state) => state.status);
  const quickReconnect = useConnectionStore((state) => state.profile.quick_reconnect);
  const setQuickReconnect = useConnectionStore((state) => state.setQuickReconnect);
  const mtu = useConnectionStore((state) => state.profile.mtu);
  const setMtu = useConnectionStore((state) => state.setMtu);
  const loggingEnabled = useConnectionStore((state) => state.loggingEnabled);
  const setLoggingEnabled = useConnectionStore((state) => state.setLoggingEnabled);
  const [open, setOpen] = useState(false);
  const locked = status.state !== "Idle" && status.state !== "Error";
  const [autoScroll, setAutoScroll] = useState(true);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

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
        <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-100 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-75">
          <div className="flex flex-col gap-4 pb-2">
            <FieldRow
              label="Protocol"
              tooltip="MASQUE disguises traffic as normal HTTPS. WireGuard is lighter and faster. gool nests two WireGuard tunnels at a speed cost."
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
              tooltip="HTTP/3 has the fastest handshake; HTTP/2 works where UDP is blocked or throttled."
            >
              <MasqueTransportToggle />
            </FieldRow>
            <FieldRow
              label="Obfuscation"
              tooltip="Disguises the handshake so DPI cannot fingerprint the protocol."
            >
              <NoizeProfileToggle />
            </FieldRow>
            <FieldRow
              label="SOCKS5 Proxy"
              tooltip="The local address exposed by Aether. The platform tunnel consumes it without modifying the core."
            >
              <BindAddressField />
            </FieldRow>
            <FieldRow
              label="System-wide tunnel"
              tooltip="Routes applications through Aether using sing-box on desktop and Android VpnService with HEV on mobile."
            >
              <SystemTunnelToggle />
            </FieldRow>

            {isAndroid && (
              <FieldRow
                label="VPN MTU"
                tooltip="1280 is the safest dual-stack value. Increase it only when the current network handles larger packets reliably."
              >
                <input
                  type="number"
                  inputMode="numeric"
                  min={1280}
                  max={1500}
                  step={4}
                  value={mtu}
                  disabled={locked}
                  onChange={(event) => setMtu(Number(event.target.value) || 1280)}
                  className="h-9 w-full rounded-md bg-black/20 px-3 text-sm text-foreground ring-1 ring-white/10 outline-none focus:ring-primary disabled:opacity-50"
                  aria-label="VPN MTU"
                />
              </FieldRow>
            )}

            {isAndroid && <CoreAdvancedSettings />}

            <FieldRow
              label="Zero Trust (organization)"
              tooltip="Connect as a managed Cloudflare Zero Trust device. Leave the team empty for normal one-click mode."
            >
              <ZeroTrustSettings />
            </FieldRow>
            <FieldRow
              label="DNS & Routing"
              tooltip="Aether 1.5 DNS, direct, block and route-file controls."
            >
              <RoutingSettings />
            </FieldRow>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                Quick reconnect
                <Tooltip>
                  <TooltipTrigger aria-label="About Quick reconnect">
                    <Info size={12} />
                  </TooltipTrigger>
                  <TooltipContent>
                    Re-tests the last working gateway first. Disable it to force a fresh scan.
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

            {isAndroid && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  Live logs
                  <Tooltip>
                    <TooltipTrigger aria-label="About Live logs">
                      <Info size={12} />
                    </TooltipTrigger>
                    <TooltipContent>
                      Off by default. When enabled, logs stay only in memory while the app is visible and are never written to storage.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Switch
                  checked={loggingEnabled}
                  onCheckedChange={(enabled) => void setLoggingEnabled(enabled)}
                  aria-label="Live logs"
                />
              </div>
            )}

            {(!isAndroid || loggingEnabled) && (
              <>
                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-[10px] tracking-wide text-muted-foreground uppercase">
                    Logs
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <div
                  ref={viewportRef}
                  onScroll={(event) => {
                    const element = event.currentTarget;
                    setAutoScroll(
                      element.scrollHeight - element.scrollTop - element.clientHeight < 24,
                    );
                  }}
                  className="max-h-64 overflow-y-auto rounded-md bg-black/20 p-2 font-mono text-xs text-muted-foreground ring-1 ring-white/10"
                >
                  {logs.length === 0 ? (
                    <p className="text-status-idle">No output yet.</p>
                  ) : (
                    logs.map((log, index) => (
                      <p key={`${log.timestamp}-${index}`}>{log.line}</p>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
