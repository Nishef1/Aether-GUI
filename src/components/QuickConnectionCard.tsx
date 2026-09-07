import { Gauge, LockKeyhole } from "lucide-react";
import { ProtocolSelect } from "@/components/ProtocolSelect";
import { ScanModeToggle } from "@/components/ScanModeToggle";
import { MasqueTransportToggle } from "@/components/MasqueTransportToggle";
import { useConnectionStore } from "@/state/connectionStore";
import type { ScanMode } from "@/types/connection";

const SCAN_COPY: Record<ScanMode, string> = {
  turbo: "Fastest discovery; use when the network is not aggressively filtering probes.",
  balanced: "Recommended default: a practical balance between speed and probe volume.",
  thorough: "Searches more candidates when normal discovery cannot find a usable route.",
  stealth: "Reduces concurrent probing for networks that react to aggressive scans.",
  ironclad: "Validates real traffic through each candidate before accepting a gateway.",
};

export function QuickConnectionCard() {
  const status = useConnectionStore((state) => state.status);
  const protocol = useConnectionStore((state) => state.profile.protocol);
  const scanMode = useConnectionStore((state) => state.profile.scan_mode);
  const locked = status.state !== "Idle" && status.state !== "Error";
  const masqueFamily = protocol === "auto" || protocol === "masque";

  return (
    <section className="w-full rounded-3xl bg-surface-1/80 p-4 ring-1 ring-white/10 backdrop-blur-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
            <Gauge size={17} />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">Connection profile</h2>
            <p className="text-[11px] leading-4 text-muted-foreground">
              The settings you are most likely to change between networks.
            </p>
          </div>
        </div>
        {locked && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/5 px-2 py-1 text-[10px] text-muted-foreground ring-1 ring-white/10">
            <LockKeyhole size={10} /> Live
          </span>
        )}
      </div>

      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">Protocol</span>
          <div className="rounded-xl bg-black/15 px-1 ring-1 ring-white/8">
            <ProtocolSelect />
          </div>
        </div>

        <div className="grid gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">Route discovery</span>
          <ScanModeToggle />
          <p className="px-1 text-[10px] leading-4 text-muted-foreground">{SCAN_COPY[scanMode]}</p>
        </div>

        {masqueFamily && (
          <div className="grid gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">MASQUE carrier</span>
            <MasqueTransportToggle />
          </div>
        )}
      </div>
    </section>
  );
}
