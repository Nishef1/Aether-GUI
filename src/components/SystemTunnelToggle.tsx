import { useEffect } from "react";
import { Switch } from "@/components/ui/switch";
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
          aria-label="Enable sing-box system tunnel"
        />
      </div>
      {error && <span className="text-[10px] text-status-error">{error}</span>}
    </div>
  );
}
