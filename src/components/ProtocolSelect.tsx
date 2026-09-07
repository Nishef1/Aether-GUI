import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConnectionStore } from "@/state/connectionStore";
import type { Protocol } from "@/types/connection";

const LABELS: Record<Protocol, string> = {
  auto: "Auto (recommended)",
  masque: "MASQUE",
  wireguard: "WireGuard",
  gool: "WARP-in-WARP (gool)",
};

export function ProtocolSelect() {
  const status = useConnectionStore((s) => s.status);
  const protocol = useConnectionStore((s) => s.profile.protocol);
  const setProtocol = useConnectionStore((s) => s.setProtocol);
  const locked = status.state !== "Idle" && status.state !== "Error";

  return (
    <Select
      value={protocol}
      onValueChange={(v) => setProtocol(v as Protocol)}
      disabled={locked}
    >
      <SelectTrigger
        size="sm"
        className="min-h-12 w-full border-transparent bg-transparent text-muted-foreground shadow-none hover:bg-surface-2"
        aria-label="Protocol"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(LABELS) as Protocol[]).map((p) => (
          <SelectItem key={p} value={p} className="min-h-11">
            {LABELS[p]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
