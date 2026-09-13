import { ShieldCheck } from "lucide-react";
import { NativeSelect } from "@/components/ui/native-select";
import { adblockDnsFor, defaultDnsFor, isAdblockDns, isDefaultDns } from "@/lib/dnsProfile";
import { useConnectionStore } from "@/state/connectionStore";

type DnsMode = "default" | "adblock" | "custom";

function dnsMode(value: string): DnsMode {
  if (isDefaultDns(value)) return "default";
  return isAdblockDns(value) ? "adblock" : "custom";
}

export function DnsProtectionControl({ disabled = false }: { disabled?: boolean }) {
  const dns = useConnectionStore((state) => state.profile.dns);
  const ipVersion = useConnectionStore((state) => state.profile.ip_version);
  const setField = useConnectionStore((state) => state.setProfileField);
  const mode = dnsMode(dns);

  const setMode = (next: DnsMode) => {
    switch (next) {
      case "default":
        setField("dns", "");
        break;
      case "adblock":
        setField("dns", adblockDnsFor(ipVersion));
        break;
      case "custom":
        if (mode !== "custom") setField("dns", defaultDnsFor(ipVersion));
        break;
    }
  };

  return (
    <div className="grid min-w-0 gap-2 rounded-2xl bg-black/15 p-3 ring-1 ring-white/8">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
          <ShieldCheck size={15} aria-hidden="true" />
        </div>
        <span className="min-w-0 flex-1 text-[11px] font-semibold text-foreground">
          DNS protection
        </span>
        {mode === "adblock" && (
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary ring-1 ring-primary/20">
            Filtering on
          </span>
        )}
      </div>

      <NativeSelect
        value={mode}
        disabled={disabled}
        onChange={(event) => setMode(event.target.value as DnsMode)}
        aria-label="DNS protection mode"
      >
        <option value="default">Default — Cloudflare DNS</option>
        <option value="adblock">Filter ads & trackers — AdGuard DNS</option>
        <option value="custom">Custom DNS</option>
      </NativeSelect>

      {mode === "custom" && (
        <label className="grid min-w-0 gap-1 text-[11px] text-muted-foreground">
          <span>Custom resolvers</span>
          <input
            value={dns}
            disabled={disabled}
            onChange={(event) => setField("dns", event.target.value)}
            placeholder={defaultDnsFor(ipVersion)}
            autoComplete="off"
            spellCheck={false}
            className="min-h-12 min-w-0 max-w-full rounded-xl bg-black/20 px-3 font-mono text-xs text-foreground ring-1 ring-white/10 outline-none transition focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            aria-describedby="custom-dns-help"
          />
          <span id="custom-dns-help" className="leading-4">
            Comma-separated resolver addresses. Aether keeps only addresses compatible with the
            selected IP family.
          </span>
        </label>
      )}
    </div>
  );
}
