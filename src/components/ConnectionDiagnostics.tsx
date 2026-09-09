import { Activity, Gauge, Network, ShieldCheck } from "lucide-react";
import { useConnectionStore } from "@/state/connectionStore";

export function ConnectionDiagnostics() {
  const status = useConnectionStore((state) => state.status);
  const runtimePath = useConnectionStore((state) => state.runtimePath);
  const runtimeCapacity = useConnectionStore((state) => state.runtimeCapacity);

  return (
    <section className="rounded-3xl bg-surface-1/60 p-4 ring-1 ring-white/10">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <Activity size={15} />
        Connection diagnostics
      </div>
      <div className="grid gap-2 text-xs text-muted-foreground">
        <p className="flex items-center gap-2"><ShieldCheck size={13} /> State: {status.state}</p>
        <p className="flex items-center gap-2"><Network size={13} /> Path: {runtimePath?.transport ?? "auto"}</p>
        <p className="flex items-center gap-2"><Gauge size={13} /> Capacity: {runtimeCapacity ? `${runtimeCapacity.downloadKbps}/${runtimeCapacity.uploadKbps} kbps` : "probing"}</p>
      </div>
    </section>
  );
}
