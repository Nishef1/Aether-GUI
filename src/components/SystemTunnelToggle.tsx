import { useEffect } from "react";
import { ShieldCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { isAndroid } from "@/lib/platform";
import { useConnectionStore } from "@/state/connectionStore";
import { useSystemTunnelStore } from "@/state/systemTunnelStore";

export function SystemTunnelToggle() {
  const status = useConnectionStore((state) => state.status);
  const selection = useSystemTunnelStore((state) => state.selection);
  const loaded = useSystemTunnelStore((state) => state.loaded);
  const error = useSystemTunnelStore((state) => state.error);
  const load = useSystemTunnelStore((state) => state.load);
  const setSelection = useSystemTunnelStore((state) => state.setSelection);
  const locked = status.state !== "Idle" && status.state !== "Error";

  useEffect(() => {
    if (!isAndroid && !loaded) void load();
  }, [load, loaded]);

  if (isAndroid) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-status-connected/[0.055] px-3.5 py-3 ring-1 ring-status-connected/15">
          <div className="flex min-w-0 items-center gap-2.5">
            <ShieldCheck className="size-4 shrink-0 text-status-connected" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground">Android device tunnel</p>
              <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                All device traffic is routed through Aether; proxy-only mode stays disabled.
              </p>
            </div>
          </div>
          <span className="shrink-0 rounded-full bg-status-connected/10 px-2.5 py-1.5 text-[10px] font-semibold text-status-connected ring-1 ring-status-connected/20">
            Always on
          </span>
        </div>
        {error && (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-status-error/5 px-3 py-2 text-[11px] text-status-error ring-1 ring-status-error/15">
            <span className="min-w-0">{error}</span>
            <button
              type="button"
              className="shrink-0 rounded-lg px-3 text-foreground ring-1 ring-white/10"
              onClick={() => void load()}
            >
              Retry
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-14 items-center justify-between gap-4 rounded-2xl bg-black/15 px-3.5 py-3 ring-1 ring-white/8">
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground">Protect the whole device</p>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
            Routes apps through Aether using the bundled sing-box TUN. Elevation may be required.
          </p>
        </div>
        <Switch
          className="shrink-0"
          checked={selection === "singbox"}
          disabled={!loaded || locked}
          onCheckedChange={(enabled) => {
            void setSelection(enabled ? "singbox" : "off");
          }}
          aria-label="Enable system-wide Aether tunnel"
        />
      </div>
      {error && <span className="text-[11px] leading-4 text-status-error">{error}</span>}
    </div>
  );
}
