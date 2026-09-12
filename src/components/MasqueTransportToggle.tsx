import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useConnectionStore } from "@/state/connectionStore";

type Transport = "http3" | "http2";

const TRANSPORTS: Transport[] = ["http2", "http3"];

const LABELS: Record<Transport, string> = {
  http2: "H2 / TCP",
  http3: "H3 / QUIC",
};

const DESCRIPTIONS: Record<Transport, string> = {
  http2:
    "Recommended first choice on restricted networks: MASQUE over TCP/HTTPS, without depending on QUIC/UDP.",
  http3:
    "QUIC over UDP — usually the fastest carrier when UDP is clean, but easier to lose on UDP-hostile networks.",
};

export function MasqueTransportToggle() {
  const status = useConnectionStore((s) => s.status);
  const protocol = useConnectionStore((s) => s.profile.protocol);
  const masqueHttp2 = useConnectionStore((s) => s.profile.masque_http2);
  const setMasqueHttp2 = useConnectionStore((s) => s.setMasqueHttp2);
  const locked = status.state !== "Idle" && status.state !== "Error";
  const notMasque = protocol === "wireguard" || protocol === "gool";
  const selected: Transport = masqueHttp2 ? "http2" : "http3";

  return (
    <div className="grid min-w-0 gap-1.5">
      <ToggleGroup
        type="single"
        variant="accent"
        value={selected}
        onValueChange={(v) => {
          if (v) setMasqueHttp2(v === "http2");
        }}
        disabled={locked || notMasque}
        aria-label="MASQUE carrier"
        className="grid w-full grid-cols-2 gap-1 rounded-2xl bg-black/20 p-1 ring-1 ring-white/10"
      >
        {TRANSPORTS.map((transport) => (
          <Tooltip key={transport}>
            <TooltipTrigger asChild>
              <ToggleGroupItem
                value={transport}
                size="sm"
                aria-label={LABELS[transport]}
                className="min-h-12 w-full min-w-0 rounded-xl text-muted-foreground transition-[background-color,color,box-shadow] duration-100 focus-visible:ring-2 focus-visible:ring-primary"
              >
                {LABELS[transport]}
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent className="max-w-72 leading-relaxed">
              {DESCRIPTIONS[transport]}
            </TooltipContent>
          </Tooltip>
        ))}
      </ToggleGroup>
      <p className="px-1 text-[10px] leading-4 text-muted-foreground">
        {DESCRIPTIONS[selected]}
      </p>
    </div>
  );
}
