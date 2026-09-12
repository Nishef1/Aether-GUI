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
      onValueChange={(value) => setProtocol(value as Protocol)}
      disabled={locked}
    >
      <SelectTrigger
        size="sm"
        className="min-h-12 w-full min-w-0 border-transparent bg-transparent text-foreground shadow-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary"
        aria-label="Connection protocol"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start" sideOffset={4}>
        {(Object.keys(LABELS) as Protocol[]).map((option) => (
          <SelectItem key={option} value={option} className="min-h-11">
            {LABELS[option]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
