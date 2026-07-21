import { Globe, Info } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useConnectionStore } from "@/state/connectionStore";

export function TunToggle() {
  const enabled = useConnectionStore((s) => s.profile.tun_enabled);
  const setEnabled = useConnectionStore((s) => s.setTunEnabled);
  const status = useConnectionStore((s) => s.status);
  const locked = status.state !== "Idle" && status.state !== "Error";

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Globe size={12} />
        System-wide TUN
        <Tooltip>
          <TooltipTrigger aria-label="About System-wide TUN">
            <Info size={12} />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            Routes system traffic through a supervised sing-box TUN and verifies the active data
            path before reporting system-wide protection. Administrator access is requested only
            for TUN mode. This is not a persistent firewall kill switch: after disconnect or TUN
            teardown, normal direct system networking resumes.
          </TooltipContent>
        </Tooltip>
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={setEnabled}
        disabled={locked}
        aria-label="System-wide TUN"
      />
    </div>
  );
}
