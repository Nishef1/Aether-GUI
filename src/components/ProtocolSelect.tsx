import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isAndroid } from "@/lib/platform";
import { useConnectionStore } from "@/state/connectionStore";
import type { Protocol } from "@/types/connection";

const LABELS: Record<Protocol, string> = {
  auto: isAndroid ? "Auto · MASQUE H2" : "Auto (recommended)",
  masque: "MASQUE",
  wireguard: "WireGuard",
  gool: "WARP-in-WARP (gool)",
};

/**
 * Auto is the normal mobile route. On Android it uses the proven HTTP/2/TCP
 * path, cached-gateway reuse, and a short verified latency sample. Explicit
 * WireGuard and Gool remain available for diagnostics and compatible networks.
 */
export function ProtocolSelect() {
  const status = useConnectionStore((state) => state.status);
  const protocol = useConnectionStore((state) => state.profile.protocol);
  const setProtocol = useConnectionStore((state) => state.setProtocol);

  const locked = status.state !== "Idle" && status.state !== "Error";

  return (
    <div className="space-y-1.5">
      <Select
        value={protocol}
        onValueChange={(value) => setProtocol(value as Protocol)}
        disabled={locked}
      >
        <SelectTrigger
          size="sm"
          className="w-full border-transparent bg-transparent text-muted-foreground shadow-none hover:bg-surface-2"
          aria-label="Protocol"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(LABELS) as Protocol[]).map((item) => (
            <SelectItem key={item} value={item}>
              {LABELS[item]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isAndroid && protocol === "auto" && (
        <p className="px-1 text-[10px] leading-relaxed text-muted-foreground">
          Fast default: verified MASQUE over HTTP/2, with the lowest-latency gateway from a brief scan.
        </p>
      )}
      {isAndroid && (protocol === "wireguard" || protocol === "gool") && (
        <p className="rounded-md border border-warning/20 bg-warning/8 px-2 py-1.5 text-[10px] leading-relaxed text-warning">
          Experimental on restricted networks: UDP handshakes may pass while usable WARP traffic is blocked.
        </p>
      )}
    </div>
  );
}
