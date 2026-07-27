import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isAndroid } from "@/lib/platform";
import { useConnectionStore } from "@/state/connectionStore";

type Transport = "http3" | "http2";

const LABELS: Record<Transport, string> = {
  http3: "HTTP/3",
  http2: "HTTP/2",
};

const DESCRIPTIONS: Record<Transport, string> = {
  http3: "QUIC over UDP — usually the fastest option when the network allows a healthy QUIC data path.",
  http2:
    "TLS over TCP — may connect where UDP or QUIC is blocked, throttled, or unstable, with potentially higher latency.",
};

export function MasqueTransportToggle() {
  const status = useConnectionStore((state) => state.status);
  const protocol = useConnectionStore((state) => state.profile.protocol);
  const masqueHttp2 = useConnectionStore((state) => state.profile.masque_http2);
  const setMasqueHttp2 = useConnectionStore((state) => state.setMasqueHttp2);

  const locked = status.state !== "Idle" && status.state !== "Error";
  const notMasque = protocol === "wireguard" || protocol === "gool";
  const androidAuto = isAndroid && protocol === "auto";
  const effectiveHttp2 = androidAuto || masqueHttp2;

  return (
    <div className="space-y-2">
      <ToggleGroup
        type="single"
        value={effectiveHttp2 ? "http2" : "http3"}
        onValueChange={(value) => {
          if (value) setMasqueHttp2(value === "http2");
        }}
        disabled={locked || notMasque || androidAuto}
        className="w-full gap-0 rounded-full bg-black/20 p-1 ring-1 ring-white/10"
      >
        {(Object.keys(LABELS) as Transport[]).map((transport) => (
          <Tooltip key={transport}>
            <TooltipTrigger asChild>
              <span className="flex-1">
                <ToggleGroupItem
                  value={transport}
                  size="sm"
                  aria-label={LABELS[transport]}
                  className="w-full rounded-full text-muted-foreground transition-colors duration-75 data-[state=on]:bg-primary/85 data-[state=on]:text-primary-foreground"
                >
                  {LABELS[transport]}
                </ToggleGroupItem>
              </span>
            </TooltipTrigger>
            <TooltipContent>{DESCRIPTIONS[transport]}</TooltipContent>
          </Tooltip>
        ))}
      </ToggleGroup>
      {androidAuto ? (
        <p className="px-1 text-[10px] leading-relaxed text-muted-foreground">
          Auto keeps HTTP/2 selected for fast, reliable TCP connectivity. Choose MASQUE explicitly to test another transport.
        </p>
      ) : isAndroid && !notMasque ? (
        <p className="px-1 text-[10px] leading-relaxed text-muted-foreground">
          HTTP/2 is recommended where UDP or QUIC is filtered.
        </p>
      ) : null}
    </div>
  );
}
