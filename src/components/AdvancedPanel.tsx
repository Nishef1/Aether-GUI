import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  FileTerminal,
  Network,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { IpVersionToggle } from "@/components/IpVersionToggle";
import { NoizeProfileToggle } from "@/components/NoizeProfileToggle";
import { BindAddressField } from "@/components/BindAddressField";
import { ZeroTrustSettings } from "@/components/ZeroTrustSettings";
import { RoutingSettings } from "@/components/RoutingSettings";
import { SystemTunnelToggle } from "@/components/SystemTunnelToggle";
import { CoreAdvancedSettings } from "@/components/CoreAdvancedSettings";
import { isAndroid } from "@/lib/platform";
import { useConnectionStore, type LogLineLimit } from "@/state/connectionStore";

interface AndroidDiagnosticsExport {
  fileName: string;
  uri: string;
}

function SectionCard({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-3xl bg-surface-1/75 p-4 ring-1 ring-white/10">
      <div className="mb-4 flex items-start gap-2.5">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/5 text-muted-foreground ring-1 ring-white/8">
          {icon}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <div>
        <p className="text-xs font-medium text-foreground">{label}</p>
        {description && (
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}

function AdvancedPanelContent() {
  const logs = useConnectionStore((state) => state.logs);
  const status = useConnectionStore((state) => state.status);
  const quickReconnect = useConnectionStore((state) => state.profile.quick_reconnect);
  const setQuickReconnect = useConnectionStore((state) => state.setQuickReconnect);
  const mtu = useConnectionStore((state) => state.profile.mtu);
  const setMtu = useConnectionStore((state) => state.setMtu);
  const loggingEnabled = useConnectionStore((state) => state.loggingEnabled);
  const setLoggingEnabled = useConnectionStore((state) => state.setLoggingEnabled);
  const logLineLimit = useConnectionStore((state) => state.logLineLimit);
  const setLogLineLimit = useConnectionStore((state) => state.setLogLineLimit);
  const clearLogs = useConnectionStore((state) => state.clearLogs);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [diagnosticsState, setDiagnosticsState] = useState<
    | { status: "idle" }
    | { status: "exporting" }
    | { status: "done"; fileName: string }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const viewportRef = useRef<HTMLDivElement>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locked = status.state !== "Idle" && status.state !== "Error";

  useEffect(() => {
    if (autoScroll && viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  useEffect(
    () => () => {
      if (copiedTimerRef.current !== null) clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  const copyLogs = async () => {
    if (logs.length === 0) return;
    try {
      await navigator.clipboard.writeText(logs.map((log) => log.line).join("\n"));
      setCopied(true);
      if (copiedTimerRef.current !== null) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => {
        copiedTimerRef.current = null;
        setCopied(false);
      }, 1_200);
    } catch {
      setCopied(false);
    }
  };

  const exportDiagnostics = async () => {
    if (!isAndroid || diagnosticsState.status === "exporting") return;
    setDiagnosticsState({ status: "exporting" });
    try {
      const result = await invoke<AndroidDiagnosticsExport>("export_android_diagnostics");
      setDiagnosticsState({ status: "done", fileName: result.fileName });
    } catch (error) {
      setDiagnosticsState({
        status: "error",
        message: String(error || "Diagnostics export failed"),
      });
    }
  };

  return (
    <div className="flex flex-col gap-3 pt-3 pb-2">
      <SectionCard
        icon={<SlidersHorizontal size={17} />}
        title="Connection behavior"
        description="Less common choices that change how Aether discovers and disguises a route."
      >
        <Field
          label="IP version"
          description="IPv4 is the safest default. Dual-stack scans both address families."
        >
          <IpVersionToggle />
        </Field>
        <Field
          label="Obfuscation"
          description="Aether 1.9 supports six profiles. Start with Firewall for MASQUE and Balanced for WireGuard."
        >
          <NoizeProfileToggle />
        </Field>
        <div className="flex min-h-12 items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-foreground">Quick reconnect</p>
            <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
              Re-test the last working gateway before doing a fresh scan.
            </p>
          </div>
          <Switch
            checked={quickReconnect}
            onCheckedChange={setQuickReconnect}
            disabled={locked}
            aria-label="Quick reconnect"
          />
        </div>
      </SectionCard>

      <SectionCard
        icon={<Network size={17} />}
        title="Device & network"
        description="System-wide routing, local listeners, DNS and route policy."
      >
        <Field label="Device tunnel">
          <SystemTunnelToggle />
        </Field>
        <Field
          label="SOCKS5 listener"
          description="The loopback proxy consumed by the device TUN. LAN binding is an explicit advanced choice."
        >
          <BindAddressField />
        </Field>
        {isAndroid && (
          <Field
            label="VPN MTU"
            description="1280 is the conservative dual-stack value. Raise it only on networks that handle larger packets reliably."
          >
            <input
              key={mtu}
              type="number"
              inputMode="numeric"
              min={1280}
              max={1500}
              step={4}
              defaultValue={mtu}
              disabled={locked}
              onBlur={(event) => {
                const raw = event.currentTarget.value.trim();
                const parsed = Number(raw);
                const next =
                  raw.length === 0 || !Number.isFinite(parsed)
                    ? mtu
                    : Math.min(1500, Math.max(1280, Math.round(parsed)));
                event.currentTarget.value = String(next);
                if (next !== mtu) setMtu(next);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                } else if (event.key === "Escape") {
                  event.currentTarget.value = String(mtu);
                  event.currentTarget.blur();
                }
              }}
              className="min-h-11 w-full rounded-xl bg-black/20 px-3 text-sm text-foreground ring-1 ring-white/10 outline-none focus:ring-primary disabled:opacity-50"
              aria-label="VPN MTU"
            />
          </Field>
        )}
        <Field
          label="DNS & routing"
          description="Direct/block lists remain effective behind the system tunnel because domain sniffing is enabled by default."
        >
          <RoutingSettings />
        </Field>
      </SectionCard>

      <SectionCard
        icon={<ShieldCheck size={17} />}
        title="Identity"
        description="Optional Cloudflare Zero Trust enrollment. Normal consumer WARP needs nothing here."
      >
        <ZeroTrustSettings />
      </SectionCard>

      <SectionCard
        icon={<SlidersHorizontal size={17} />}
        title="Core tuning"
        description="Aether 1.9 features and expert recovery controls. Defaults are intentionally conservative."
      >
        <CoreAdvancedSettings />
      </SectionCard>

      <SectionCard
        icon={<FileTerminal size={17} />}
        title="Diagnostics"
        description="Live logs are opt-in. Android can also export a bounded troubleshooting bundle without adb."
      >
        {isAndroid && (
          <div className="grid gap-2 rounded-2xl bg-black/15 p-3 ring-1 ring-white/8">
            <div className="flex min-h-12 items-center justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-foreground">Diagnostics bundle</p>
                <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                  Saves runtime status, network capabilities, the latest failure and a bounded log tail to Downloads/Aether.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void exportDiagnostics()}
                disabled={diagnosticsState.status === "exporting"}
                className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-medium text-foreground ring-1 ring-white/12 transition hover:bg-white/5 disabled:opacity-50"
              >
                <Download size={13} />
                {diagnosticsState.status === "exporting" ? "Exporting…" : "Export ZIP"}
              </button>
            </div>
            {diagnosticsState.status === "done" && (
              <p className="break-all text-[11px] text-status-connected">
                Saved to Downloads/Aether/{diagnosticsState.fileName}
              </p>
            )}
            {diagnosticsState.status === "error" && (
              <p className="break-words text-[11px] text-destructive">
                Export failed: {diagnosticsState.message}
              </p>
            )}
          </div>
        )}

        <div className="flex min-h-12 items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-foreground">Live logs</p>
            <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
              Enable only while troubleshooting a connection.
            </p>
          </div>
          <Switch
            checked={loggingEnabled}
            onCheckedChange={(enabled) => void setLoggingEnabled(enabled)}
            aria-label="Live logs"
          />
        </div>

        {loggingEnabled && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="font-mono">
                {logs.length} / {logLineLimit} lines
              </span>
              <div className="flex items-center gap-1.5">
                <select
                  value={logLineLimit}
                  onChange={(event) =>
                    setLogLineLimit(Number(event.target.value) as LogLineLimit)
                  }
                  className="min-h-10 rounded-lg bg-black/20 px-2 text-[11px] text-foreground ring-1 ring-white/10 outline-none focus:ring-primary"
                  aria-label="Maximum log lines"
                >
                  <option value={100}>100</option>
                  <option value={250}>250</option>
                  <option value={500}>500</option>
                </select>
                <button
                  type="button"
                  onClick={() => void copyLogs()}
                  disabled={logs.length === 0}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-foreground ring-1 ring-white/10 hover:bg-white/5 disabled:opacity-40"
                  aria-label="Copy logs"
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  type="button"
                  onClick={clearLogs}
                  disabled={logs.length === 0}
                  className="inline-flex size-10 items-center justify-center rounded-lg text-foreground ring-1 ring-white/10 hover:bg-white/5 disabled:opacity-40"
                  aria-label="Clear logs"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>

            <div
              ref={viewportRef}
              onScroll={(event) => {
                const element = event.currentTarget;
                setAutoScroll(element.scrollHeight - element.scrollTop - element.clientHeight < 24);
              }}
              className="max-h-72 overflow-y-auto rounded-xl bg-black/25 p-3 font-mono text-xs leading-5 text-muted-foreground ring-1 ring-white/10"
            >
              {logs.length === 0 ? (
                <p className="text-status-idle">No output yet.</p>
              ) : (
                logs.map((log, index) => <p key={`${log.timestamp}-${index}`}>{log.line}</p>)
              )}
            </div>
          </>
        )}
      </SectionCard>
    </div>
  );
}

export function AdvancedPanel() {
  const [open, setOpen] = useState(false);

  return (
    <div className="w-full">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="group flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl bg-white/[0.035] px-4 text-left ring-1 ring-white/10 outline-none transition hover:bg-white/[0.055] focus-visible:ring-2 focus-visible:ring-primary">
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/5 text-muted-foreground">
              <Settings2 size={17} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-foreground">More settings</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                Network, identity, routing and Aether 1.9 tuning
              </span>
            </span>
          </span>
          <ChevronDown
            size={17}
            className="shrink-0 text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-180"
          />
        </CollapsibleTrigger>

        <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-100 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-75">
          {open ? <AdvancedPanelContent /> : null}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
