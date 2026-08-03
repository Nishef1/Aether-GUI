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
    if (!loaded) void load();
  }, [load, loaded]);

  if (isAndroid) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3 rounded-lg bg-white/5 px-3 py-2.5 ring-1 ring-white/10">
          <div className="flex min-w-0 items-center gap-2.5">
            <ShieldCheck className="size-4 shrink-0 text-status-connected" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground">Android VPN tunnel</p>
              <p className="text-[10px] text-muted-foreground">
                All device traffic is routed through Aether. Proxy-only mode is disabled.
              </p>
            </div>
          </div>
          <span className="shrink-0 rounded-full bg-status-connected/10 px-2 py-1 text-[10px] font-medium text-status-connected ring-1 ring-status-connected/20">
            Always on
          </span>
        </div>
        {error && <span className="text-[10px] text-status-error">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-xs text-foreground">Route all apps through Aether</span>
          <span className="text-[10px] text-muted-foreground">
            Uses the pinned sing-box TUN sidecar; administrator approval may be required.
          </span>
        </div>
        <Switch
          checked={selection === "singbox"}
          disabled={!loaded || locked}
          onCheckedChange={(enabled) => {
            void setSelection(enabled ? "singbox" : "off");
          }}
          aria-label="Enable system-wide Aether tunnel"
        />
      </div>
      {error && <span className="text-[10px] text-status-error">{error}</span>}
    </div>
  );
}
