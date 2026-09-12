import { ShieldCheck } from "lucide-react";
import { NativeSelect } from "@/components/ui/native-select";
import { useConnectionStore } from "@/state/connectionStore";
import type { IpVersion } from "@/types/connection";

const CLOUDFLARE_DNS_V4 = "1.1.1.1,1.0.0.1";
const CLOUDFLARE_DNS_V6 = "2606:4700:4700::1111,2606:4700:4700::1001";
const ADBLOCK_DNS =
  "94.140.14.14,94.140.15.15,2a10:50c0::ad1:ff,2a10:50c0::ad2:ff";

type DnsMode = "default" | "adblock" | "custom";

function normalizedDns(value: string): string[] {
  return value
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function dnsMode(value: string): DnsMode {
  const values = normalizedDns(value);
  if (values.length === 0) return "default";

  const adblock = new Set(normalizedDns(ADBLOCK_DNS));
  return values.length === adblock.size && values.every((value) => adblock.has(value))
    ? "adblock"
    : "custom";
}

function defaultCustomDns(ipVersion: IpVersion): string {
  if (ipVersion === "v6") return CLOUDFLARE_DNS_V6;
  if (ipVersion === "both") return `${CLOUDFLARE_DNS_V4},${CLOUDFLARE_DNS_V6}`;
  return CLOUDFLARE_DNS_V4;
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
        setField("dns", ADBLOCK_DNS);
        break;
      case "custom":
        if (mode !== "custom") setField("dns", defaultCustomDns(ipVersion));
        break;
    }
  };

  return (
    <div className="grid min-w-0 gap-2 rounded-2xl bg-black/15 p-3 ring-1 ring-white/8">
      <div className="flex min-w-0 items-start gap-2.5">
        <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
          <ShieldCheck size={15} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="min-w-0 text-[11px] font-semibold text-foreground">DNS protection</span>
            {mode === "adblock" && (
              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary ring-1 ring-primary/20">
                Filtering on
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
            DNS follows the protected path and the selected Internet IP family. AdGuard DNS filters
            many ad, tracker and phishing domains at DNS level.
          </p>
        </div>
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
        <label className="grid min-w-0 gap-1 text-[10px] text-muted-foreground">
          <span>Custom resolvers</span>
          <input
            value={dns}
            disabled={disabled}
            onChange={(event) => setField("dns", event.target.value)}
            placeholder={defaultCustomDns(ipVersion)}
            autoComplete="off"
            spellCheck={false}
            className="min-h-12 min-w-0 max-w-full rounded-xl bg-black/20 px-3 font-mono text-xs text-foreground ring-1 ring-white/10 outline-none transition focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            aria-describedby="custom-dns-help"
          />
          <span id="custom-dns-help" className="leading-4">
            Use resolver addresses separated by commas. At runtime Aether keeps resolvers matching
            the selected IP family and uses the matching Cloudflare pair if none remain. Malformed
            entries are ignored only when another usable resolver remains. App-level encrypted DNS
            can bypass DNS-level filtering.
          </span>
        </label>
      )}
    </div>
  );
}
