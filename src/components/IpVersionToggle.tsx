import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useConnectionStore } from "@/state/connectionStore";
import type { IpVersion } from "@/types/connection";

const LABELS: Record<IpVersion, string> = {
  v4: "IPv4",
  v6: "IPv6",
  both: "Both",
};

export function IpVersionToggle() {
  const status = useConnectionStore((s) => s.status);
  const ipVersion = useConnectionStore((s) => s.profile.ip_version);
  const setIpVersion = useConnectionStore((s) => s.setIpVersion);
  const locked = status.state !== "Idle" && status.state !== "Error";

  return (
    <ToggleGroup
      type="single"
      value={ipVersion}
      onValueChange={(v) => {
        if (v) setIpVersion(v as IpVersion);
      }}
      disabled={locked}
      className="w-full gap-0 rounded-2xl bg-black/20 p-1 ring-1 ring-white/10"
    >
      {(Object.keys(LABELS) as IpVersion[]).map((v) => (
        <ToggleGroupItem
          key={v}
          value={v}
          size="sm"
          aria-label={LABELS[v]}
          className="min-h-12 flex-1 rounded-xl text-muted-foreground transition-colors duration-75 data-[state=on]:bg-primary/85 data-[state=on]:text-primary-foreground"
        >
          {LABELS[v]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
