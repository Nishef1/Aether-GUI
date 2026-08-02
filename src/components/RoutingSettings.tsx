import { useConnectionStore } from "@/state/connectionStore";

const INPUT =
  "h-8 w-full rounded-md bg-black/20 px-2 text-xs text-foreground ring-1 ring-white/10 outline-none focus:ring-primary disabled:opacity-50";
const AREA =
  "min-h-16 w-full resize-y rounded-md bg-black/20 px-2 py-1.5 text-xs text-foreground ring-1 ring-white/10 outline-none focus:ring-primary disabled:opacity-50";
const PRESET =
  "rounded-md px-2 py-1 text-[10px] text-muted-foreground ring-1 ring-white/10 transition-colors hover:bg-white/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50";

const DNS_PRESETS = [
  { label: "Default", value: "" },
  { label: "Cloudflare", value: "1.1.1.1,1.0.0.1" },
  { label: "Quad9", value: "9.9.9.9,149.112.112.112" },
  { label: "Google", value: "8.8.8.8,8.8.4.4" },
] as const;

const IRAN_DIRECT = "domain:ir";
const LAN_DIRECT = "private";
const COMMON_AD_BLOCK = [
  "domain:doubleclick.net",
  "domain:googlesyndication.com",
  "domain:googleadservices.com",
  "domain:adservice.google.com",
  "domain:adnxs.com",
  "domain:adsrvr.org",
  "domain:criteo.com",
  "domain:taboola.com",
  "domain:outbrain.com",
].join("\n");

/** Aether 1.5.0 DNS and routing controls. Each list accepts the exact
 * comma/newline-separated format documented by the core. */
export function RoutingSettings() {
  const profile = useConnectionStore((state) => state.profile);
  const status = useConnectionStore((state) => state.status);
  const setDns = useConnectionStore((state) => state.setDns);
  const setRouteBlock = useConnectionStore((state) => state.setRouteBlock);
  const setRouteDirect = useConnectionStore((state) => state.setRouteDirect);
  const setRoutesFile = useConnectionStore((state) => state.setRoutesFile);
  const locked = status.state !== "Idle" && status.state !== "Error";

  const applyRoutingPreset = (preset: "iran" | "lan" | "ads" | "iran-ads" | "clear") => {
    switch (preset) {
      case "iran":
        setRouteDirect(IRAN_DIRECT);
        setRouteBlock("");
        break;
      case "lan":
        setRouteDirect(LAN_DIRECT);
        setRouteBlock("");
        break;
      case "ads":
        setRouteDirect("");
        setRouteBlock(COMMON_AD_BLOCK);
        break;
      case "iran-ads":
        setRouteDirect(`${IRAN_DIRECT}\n${LAN_DIRECT}`);
        setRouteBlock(COMMON_AD_BLOCK);
        break;
      case "clear":
        setRouteDirect("");
        setRouteBlock("");
        setRoutesFile("");
        break;
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-md bg-black/10 p-2 ring-1 ring-white/10">
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-medium text-muted-foreground">DNS preset</span>
        <div className="flex flex-wrap gap-1.5">
          {DNS_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              disabled={locked}
              onClick={() => setDns(preset.value)}
              aria-pressed={profile.dns === preset.value}
              className={`${PRESET} aria-pressed:bg-primary/15 aria-pressed:text-primary aria-pressed:ring-primary/40`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={profile.dns}
          disabled={locked}
          onChange={(event) => setDns(event.target.value)}
          placeholder="Tunnel DNS, e.g. 1.1.1.1,1.0.0.1 (optional)"
          className={INPUT}
          aria-label="Tunnel DNS resolvers"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-medium text-muted-foreground">Routing preset</span>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" disabled={locked} onClick={() => applyRoutingPreset("iran")} className={PRESET}>
            Iran direct
          </button>
          <button type="button" disabled={locked} onClick={() => applyRoutingPreset("lan")} className={PRESET}>
            LAN direct
          </button>
          <button type="button" disabled={locked} onClick={() => applyRoutingPreset("ads")} className={PRESET}>
            Block ads
          </button>
          <button type="button" disabled={locked} onClick={() => applyRoutingPreset("iran-ads")} className={PRESET}>
            Iran + ads
          </button>
          <button type="button" disabled={locked} onClick={() => applyRoutingPreset("clear")} className={PRESET}>
            Clear
          </button>
        </div>
      </div>

      <textarea
        value={profile.route_block}
        disabled={locked}
        onChange={(event) => setRouteBlock(event.target.value)}
        placeholder="Block: domains, CIDRs, ports… (optional)"
        className={AREA}
        aria-label="Blocked routes"
      />
      <textarea
        value={profile.route_direct}
        disabled={locked}
        onChange={(event) => setRouteDirect(event.target.value)}
        placeholder="Direct: banking, LAN, domestic sites… (optional)"
        className={AREA}
        aria-label="Direct routes"
      />
      <input
        type="text"
        value={profile.routes_file}
        disabled={locked}
        onChange={(event) => setRoutesFile(event.target.value)}
        placeholder="Rules file path (optional)"
        className={INPUT}
        aria-label="Routing rules file path"
      />
      <p className="text-[10px] leading-4 text-muted-foreground">
        Iran direct covers <code>.ir</code> domains; add custom CIDRs for domestic services on other domains. Supports domain, IP/CIDR, <code>port:443</code>, <code>private</code>, and Aether&apos;s <code>full:</code>/<code>keyword:</code>/<code>regexp:</code> rules. Block wins over direct.
      </p>
    </div>
  );
}
