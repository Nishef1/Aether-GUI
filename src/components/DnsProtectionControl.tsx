import { ShieldCheck } from "lucide-react";
import { useConnectionStore } from "@/state/connectionStore";

const ADBLOCK_DNS = "94.140.14.14,94.140.15.15";
const DEFAULT_CUSTOM_DNS = "1.1.1.1,1.0.0.1";

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

export function DnsProtectionControl({ disabled = false }: { disabled?: boolean }) {
  const dns = useConnectionStore((state) => state.profile.dns);
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
        if (mode !== "custom") setField("dns", DEFAULT_CUSTOM_DNS);
        break;
    }
  };

  return (
    <div className="grid gap-2 rounded-2xl bg-black/15 p-3 ring-1 ring-white/8">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
          <ShieldCheck size={15} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-foreground">DNS protection</span>
            {mode === "adblock" && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary ring-1 ring-primary/20">
                Filtering on
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
            With full-device VPN enabled, DNS follows the protected path. AdGuard DNS filters many
            ad, tracker and phishing domains at DNS level.
          </p>
        </div>
      </div>

      <select
        value={mode}
        disabled={disabled}
        onChange={(event) => setMode(event.target.value as DnsMode)}
        className="min-h-12 w-full rounded-xl bg-black/20 px-3 text-xs text-foreground ring-1 ring-white/10 outline-none transition focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
        aria-label="DNS protection mode"
      >
        <option value="default">Default — Cloudflare DNS</option>
        <option value="adblock">Filter ads & trackers — AdGuard DNS</option>
        <option value="custom">Custom DNS</option>
      </select>

      {mode === "custom" && (
        <label className="grid gap-1 text-[10px] text-muted-foreground">
          <span>Custom resolvers</span>
          <input
            value={dns}
            disabled={disabled}
            onChange={(event) => setField("dns", event.target.value)}
            placeholder="1.1.1.1,1.0.0.1"
            autoComplete="off"
            spellCheck={false}
            className="min-h-12 rounded-xl bg-black/20 px-3 font-mono text-xs text-foreground ring-1 ring-white/10 outline-none transition focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            aria-describedby="custom-dns-help"
          />
          <span id="custom-dns-help" className="leading-4">
            Use IPv4/IPv6 resolver addresses separated by commas. Malformed entries are ignored; if
            none are usable Aether falls back to its Cloudflare pair. App-level encrypted DNS can
            bypass this filtering.
          </span>
        </label>
      )}
    </div>
  );
}
