import { useConnectionStore } from "@/state/connectionStore";

const INPUT =
  "min-h-12 w-full rounded-xl bg-black/20 px-3 text-sm text-foreground ring-1 ring-white/10 outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50";
const AREA =
  "min-h-24 w-full resize-y rounded-xl bg-black/20 px-3 py-2.5 text-sm text-foreground ring-1 ring-white/10 outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50";
const PRESET =
  "min-h-12 rounded-xl px-3 py-2 text-[11px] text-muted-foreground ring-1 ring-white/10 transition-colors hover:bg-white/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50 aria-pressed:bg-primary/15 aria-pressed:text-primary aria-pressed:ring-primary/40";

const IRAN_DIRECT = "domain:ir";
const LAN_DIRECT = "private";
const IRAN_AND_LAN_DIRECT = `${IRAN_DIRECT}\n${LAN_DIRECT}`;
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

type RoutingPreset = "iran" | "lan" | "ads" | "iran-ads" | "clear";

const PRESET_LABELS: Record<RoutingPreset, string> = {
  iran: "Iran direct",
  lan: "LAN direct",
  ads: "Block ads",
  "iran-ads": "Iran + LAN + ads",
  clear: "No routing overrides",
};

/** Aether 1.9 route controls. DNS intentionally lives in the primary
 * connection card so one profile field never has two competing UI owners. */
export function RoutingSettings() {
  const profile = useConnectionStore((state) => state.profile);
  const status = useConnectionStore((state) => state.status);
  const setRouteBlock = useConnectionStore((state) => state.setRouteBlock);
  const setRouteDirect = useConnectionStore((state) => state.setRouteDirect);
  const setRoutesFile = useConnectionStore((state) => state.setRoutesFile);
  const locked = status.state !== "Idle" && status.state !== "Error";

  const direct = profile.route_direct.trim();
  const blocked = profile.route_block.trim();
  const routesFile = profile.routes_file.trim();
  const selectedPreset: RoutingPreset | null =
    !direct && !blocked && !routesFile
      ? "clear"
      : direct === IRAN_DIRECT && !blocked && !routesFile
        ? "iran"
        : direct === LAN_DIRECT && !blocked && !routesFile
          ? "lan"
          : !direct && blocked === COMMON_AD_BLOCK && !routesFile
            ? "ads"
            : direct === IRAN_AND_LAN_DIRECT && blocked === COMMON_AD_BLOCK && !routesFile
              ? "iran-ads"
              : null;
  const hasDirectExposure = Boolean(direct || routesFile);

  const applyRoutingPreset = (preset: RoutingPreset) => {
    switch (preset) {
      case "iran":
        setRouteDirect(IRAN_DIRECT);
        setRouteBlock("");
        setRoutesFile("");
        break;
      case "lan":
        setRouteDirect(LAN_DIRECT);
        setRouteBlock("");
        setRoutesFile("");
        break;
      case "ads":
        setRouteDirect("");
        setRouteBlock(COMMON_AD_BLOCK);
        setRoutesFile("");
        break;
      case "iran-ads":
        setRouteDirect(IRAN_AND_LAN_DIRECT);
        setRouteBlock(COMMON_AD_BLOCK);
        setRoutesFile("");
        break;
      case "clear":
        setRouteDirect("");
        setRouteBlock("");
        setRoutesFile("");
        break;
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-black/10 p-3 ring-1 ring-white/10">
      <div className="flex flex-col gap-2">
        <div>
          <span className="text-[11px] font-medium text-foreground">Routing presets</span>
          <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
            Presets replace the route lists below. Custom edits are kept as custom rules.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label="Routing presets">
          <button
            type="button"
            disabled={locked}
            onClick={() => applyRoutingPreset("iran")}
            aria-pressed={selectedPreset === "iran"}
            className={PRESET}
          >
            Iran direct
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => applyRoutingPreset("lan")}
            aria-pressed={selectedPreset === "lan"}
            className={PRESET}
          >
            LAN direct
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => applyRoutingPreset("ads")}
            aria-pressed={selectedPreset === "ads"}
            className={PRESET}
          >
            Block ads
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => applyRoutingPreset("iran-ads")}
            aria-pressed={selectedPreset === "iran-ads"}
            className={PRESET}
          >
            Iran + LAN + ads
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => applyRoutingPreset("clear")}
            aria-pressed={selectedPreset === "clear"}
            className={PRESET}
          >
            Clear rules
          </button>
        </div>
        <p className="px-1 text-[10px] text-muted-foreground" aria-live="polite">
          Current: {selectedPreset ? PRESET_LABELS[selectedPreset] : "Custom rules"}
        </p>
      </div>

      <label className="grid gap-1.5">
        <span className="text-[11px] font-medium text-foreground">Blocked destinations</span>
        <textarea
          value={profile.route_block}
          disabled={locked}
          onChange={(event) => setRouteBlock(event.target.value)}
          placeholder="Domains, CIDRs or ports to block…"
          className={AREA}
          aria-label="Blocked routes"
          spellCheck={false}
        />
      </label>

      <label className="grid gap-1.5">
        <span className="text-[11px] font-medium text-foreground">Direct bypass</span>
        <textarea
          value={profile.route_direct}
          disabled={locked}
          onChange={(event) => setRouteDirect(event.target.value)}
          placeholder="Banking, LAN or domestic destinations…"
          className={AREA}
          aria-label="Direct routes"
          aria-describedby={hasDirectExposure ? "direct-routing-warning" : undefined}
          spellCheck={false}
        />
      </label>

      <label className="grid gap-1.5">
        <span className="text-[11px] font-medium text-foreground">Rules file</span>
        <input
          type="text"
          value={profile.routes_file}
          disabled={locked}
          onChange={(event) => setRoutesFile(event.target.value)}
          placeholder="Optional path to a rules file"
          className={INPUT}
          aria-label="Routing rules file path"
          aria-describedby={hasDirectExposure ? "direct-routing-warning" : undefined}
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      {hasDirectExposure && (
        <p
          id="direct-routing-warning"
          className="rounded-xl bg-status-connecting/5 px-3 py-2 text-[10px] leading-4 text-status-connecting ring-1 ring-status-connecting/15"
        >
          Direct rules intentionally bypass Aether for matching destinations. Those destinations can
          see your original network IP; use direct routing only when that exposure is intentional.
        </p>
      )}
      <p className="text-[10px] leading-4 text-muted-foreground">
        Iran direct covers <code>.ir</code> domains only; add explicit CIDRs/domains for other
        domestic services. Supports domain, IP/CIDR, <code>port:443</code>, <code>private</code>, and
        Aether&apos;s <code>full:</code>/<code>keyword:</code>/<code>regexp:</code> rules. Block wins
        over direct.
      </p>
    </div>
  );
}
