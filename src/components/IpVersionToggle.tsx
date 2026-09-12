import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { adblockDnsFor, isAdblockDns } from "@/lib/dnsProfile";
import { useConnectionStore } from "@/state/connectionStore";
import type { IpVersion } from "@/types/connection";

const LABELS: Record<IpVersion, string> = {
  v4: "IPv4",
  v6: "IPv6",
  both: "Both",
};

const DESCRIPTIONS: Record<IpVersion, string> = {
  v4: "IPv4 only. IPv6 internet traffic stays blocked across Automatic fallbacks and every transport.",
  v6: "IPv6 only. IPv4 internet traffic stays blocked across Automatic fallbacks and every transport.",
  both: "Dual stack. IPv4 and IPv6 internet traffic are both allowed through the protected path.",
};

export function IpVersionToggle() {
  const status = useConnectionStore((s) => s.status);
  const ipVersion = useConnectionStore((s) => s.profile.ip_version);
  const dns = useConnectionStore((s) => s.profile.dns);
  const setIpVersion = useConnectionStore((s) => s.setIpVersion);
  const setField = useConnectionStore((s) => s.setProfileField);
  const locked = status.state !== "Idle" && status.state !== "Error";

  const selectFamily = (next: IpVersion) => {
    const preserveAdblock = isAdblockDns(dns);
    setIpVersion(next);
    if (preserveAdblock) setField("dns", adblockDnsFor(next));
  };

  return (
    <div className="grid min-w-0 gap-1.5">
      <ToggleGroup
        type="single"
        value={ipVersion}
        onValueChange={(v) => {
          if (v) selectFamily(v as IpVersion);
        }}
        disabled={locked}
        aria-label="Internet IP family"
        className="grid w-full grid-cols-3 gap-1 rounded-2xl bg-black/20 p-1 ring-1 ring-white/10"
      >
        {(Object.keys(LABELS) as IpVersion[]).map((v) => (
          <ToggleGroupItem
            key={v}
            value={v}
            size="sm"
            aria-label={`${LABELS[v]} internet family`}
            className="min-h-12 w-full min-w-0 rounded-xl text-muted-foreground transition-[background-color,color,box-shadow] duration-100 focus-visible:ring-2 focus-visible:ring-primary data-[state=on]:bg-primary data-[state=on]:font-semibold data-[state=on]:text-primary-foreground data-[state=on]:shadow-sm data-[state=on]:ring-1 data-[state=on]:ring-primary/80"
          >
            {LABELS[v]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className="px-1 text-[10px] leading-4 text-muted-foreground" aria-live="polite">
        {DESCRIPTIONS[ipVersion]}
      </p>
    </div>
  );
}
