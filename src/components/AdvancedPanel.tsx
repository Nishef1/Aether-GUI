import { useState, type ReactNode } from "react"
import { ChevronDown, Info, Settings2 } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Switch } from "@/components/ui/switch"
import { ProtocolSelect } from "@/components/ProtocolSelect"
import { ScanModeToggle } from "@/components/ScanModeToggle"
import { IpVersionToggle } from "@/components/IpVersionToggle"
import { MasqueTransportToggle } from "@/components/MasqueTransportToggle"
import { NoizeProfileToggle } from "@/components/NoizeProfileToggle"
import { BindAddressField } from "@/components/BindAddressField"
import { TunEngineToggle } from "@/components/TunEngineToggle"
import { isAndroid } from "@/lib/platform"
import { useConnectionStore } from "@/state/connectionStore"

const DEFAULT_DNS = "1.1.1.1"
const DNS_PRESETS = [
  { value: "1.1.1.1", label: "Cloudflare · 1.1.1.1" },
  { value: "8.8.8.8", label: "Google · 8.8.8.8" },
  { value: "9.9.9.9", label: "Quad9 · 9.9.9.9" },
  { value: "94.140.14.14", label: "AdGuard · 94.140.14.14" },
] as const

function normalizeIpAddress(value: string): string | null {
  const candidate = value.trim()
  const ipv4 = candidate.split(".")
  if (
    ipv4.length === 4 &&
    ipv4.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  ) {
    return ipv4.map((part) => String(Number(part))).join(".")
  }

  if (!candidate.includes(":")) return null
  try {
    const hostname = new URL(`http://[${candidate}]/`).hostname.replace(/^\[|\]$/g, "")
    return hostname.includes(":") ? hostname : null
  } catch {
    return null
  }
}

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

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string
  description: string
  checked: boolean
  disabled: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-white/6 bg-black/10 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-xs text-foreground">{label}</p>
        <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={label}
        className="mt-0.5 shrink-0"
      />
    </div>
  )
}

function DnsServerField() {
  const status = useConnectionStore((state) => state.status)
  const dnsServer = useConnectionStore((state) => state.profile.dns_server)
  const setDnsServer = useConnectionStore((state) => state.setDnsServer)
  const [customMode, setCustomMode] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const locked = status.state !== "Idle" && status.state !== "Error"
  const preset = DNS_PRESETS.some((entry) => entry.value === dnsServer)
  const selection = customMode || !preset ? "custom" : dnsServer
  const displayed = draft ?? (preset ? "" : dnsServer)
  const normalized = normalizeIpAddress(displayed)
  const invalid = displayed.length > 0 && normalized === null

  const commitCustom = () => {
    if (displayed.trim().length === 0) {
      setDnsServer(DEFAULT_DNS)
      setDraft(null)
      setCustomMode(false)
      return
    }
    if (!normalized) return
    setDnsServer(normalized)
    setDraft(null)
    setCustomMode(false)
  }

  return (
    <div className="space-y-2">
      <Select
        value={selection}
        disabled={locked}
        onValueChange={(value) => {
          if (value === "custom") {
            setCustomMode(true)
            setDraft(preset ? "" : dnsServer)
            return
          }
          setCustomMode(false)
          setDraft(null)
          setDnsServer(value)
        }}
      >
        <SelectTrigger
          size="sm"
          className="w-full border-transparent bg-transparent text-muted-foreground shadow-none hover:bg-surface-2"
          aria-label="DNS resolver"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DNS_PRESETS.map((entry) => (
            <SelectItem key={entry.value} value={entry.value}>
              {entry.label}
            </SelectItem>
          ))}
          <SelectItem value="custom">Custom IP</SelectItem>
        </SelectContent>
      </Select>

      {selection === "custom" && (
        <div className="space-y-1">
          <input
            type="text"
            value={displayed}
            placeholder={DEFAULT_DNS}
            disabled={locked}
            onChange={(event) => setDraft(event.target.value.slice(0, 64))}
            onBlur={commitCustom}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur()
              if (event.key === "Escape") {
                event.preventDefault()
                setDraft(null)
                setCustomMode(false)
              }
            }}
            aria-label="Custom DNS IP address"
            aria-invalid={invalid}
            className="h-8 w-full rounded-md bg-black/20 px-2.5 text-xs text-foreground ring-1 ring-white/10 outline-none focus:ring-primary disabled:opacity-50"
          />
          {invalid && (
            <p className="text-[10px] text-destructive" role="status">
              Enter a valid IPv4 or IPv6 address.
            </p>
          )}
        </div>
      )}

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Controls system and plaintext DNS in TUN mode. Browser Secure DNS remains tunneled but may
        use and report its own provider.
      </p>
    </div>
  )
}

export function AdvancedPanel() {
  const status = useConnectionStore((state) => state.status)
  const mode = useConnectionStore((state) => state.profile.connection_mode)
  const tunEngine = useConnectionStore((state) => state.profile.tun_engine)
  const quickReconnect = useConnectionStore(
    (state) => state.profile.quick_reconnect
  )
  const webrtcLeakProtection = useConnectionStore(
    (state) => state.profile.webrtc_leak_protection
  )
  const profileSaveError = useConnectionStore((state) => state.profileSaveError)
  const setQuickReconnect = useConnectionStore(
    (state) => state.setQuickReconnect
  )
  const setWebrtcLeakProtection = useConnectionStore(
    (state) => state.setWebrtcLeakProtection
  )
  const [open, setOpen] = useState(false)
  const locked = status.state !== "Idle" && status.state !== "Error"

  return (
    <div className="w-full max-w-sm shrink-0">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 rounded-xl border border-white/8 bg-surface-2/80 px-3 py-2.5 text-left outline-none transition-[border-color,background-color,box-shadow,transform] duration-200 ease-out hover:-translate-y-px hover:border-primary/35 hover:bg-surface-3/90 hover:shadow-[0_8px_24px_rgba(0,0,0,0.18)] focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=open]:border-primary/30 data-[state=open]:bg-primary/8 data-[state=open]:shadow-[inset_0_1px_0_rgba(242,113,28,0.18)] motion-reduce:transform-none motion-reduce:transition-none">
          <span className="flex min-w-0 items-center gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary ring-1 ring-primary/20 transition-colors duration-200 group-hover:bg-primary/18 group-data-[state=open]:bg-primary/20">
              <Settings2 size={16} aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium leading-tight text-foreground">
                Advanced settings
              </span>
              <span className="mt-0.5 block truncate text-[10px] leading-tight text-muted-foreground">
                Protocol, routing, privacy, and reconnect options
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
            <div className="flex flex-col gap-4 rounded-xl border border-border/80 bg-surface-1/80 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
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
                <>
                  {!isAndroid && (
                    <>
                      <FieldRow
                        label="System TUN engine"
                        tooltip="sing-box is recommended on Windows because strict routing and DNS hijacking provide consistent system DNS enforcement."
                      >
                        <TunEngineToggle />
                      </FieldRow>
                      {tunEngine === "xray" && (
                        <p
                          className="rounded-lg border border-warning/25 bg-warning/8 px-2.5 py-2 text-[10px] leading-relaxed text-warning"
                          role="status"
                        >
                          Xray protects plaintext DNS, but browser Secure DNS can keep its own provider.
                        </p>
                      )}
                    </>
                  )}
                  <FieldRow
                    label="DNS resolver"
                    tooltip="Plain DNS is intercepted and sent to this resolver through Aether. Encrypted DNS selected inside a browser is still tunneled, but the browser controls its provider."
                  >
                    <DnsServerField />
                  </FieldRow>
                  {isAndroid && (
                    <ToggleRow
                      label="WebRTC leak protection"
                      description="Carries STUN/WebRTC UDP through the SOCKS TCP relay. This prevents direct UDP egress but can increase call and gaming latency."
                      checked={webrtcLeakProtection}
                      disabled={locked}
                      onCheckedChange={setWebrtcLeakProtection}
                    />
                  )}
                </>
              )}

              {mode !== "tunnel" && (
                <FieldRow
                  label="SOCKS5 Proxy"
                  tooltip="The local SOCKS5 endpoint exposed for apps in Proxy and Both modes. It is always restricted to loopback because the core proxy has no authentication."
                >
                  <BindAddressField />
                </FieldRow>
              )}

              <ToggleRow
                label="Quick reconnect"
                description="Tries the last working gateway first. Disable it to force a fresh route scan on every connection."
                checked={quickReconnect}
                disabled={locked}
                onCheckedChange={setQuickReconnect}
              />

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
