import { useEffect } from "react";
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
  const activeSelection = isAndroid ? "native" : "singbox";

  useEffect(() => {
    if (!loaded) void load();
  }, [load, loaded]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-xs text-foreground">Route all apps through Aether</span>
          <span className="text-[10px] text-muted-foreground">
            {isAndroid
              ? "Uses Android VpnService with the pinned HEV TUN-to-SOCKS dataplane."
              : "Uses the pinned sing-box TUN sidecar; administrator approval may be required."}
          </span>
        </div>
        <Switch
          checked={selection === activeSelection}
          disabled={!loaded || locked}
          onCheckedChange={(enabled) => {
            void setSelection(enabled ? activeSelection : "off");
          }}
          aria-label="Enable system-wide Aether tunnel"
        />
      </div>
      {error && <span className="text-[10px] text-status-error">{error}</span>}
    </div>
  );
}
