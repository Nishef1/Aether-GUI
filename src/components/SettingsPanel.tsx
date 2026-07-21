import { X } from "lucide-react";
import { CoreManagerPanel } from "@/components/CoreManagerPanel";
import { LiveLogViewer } from "@/components/LiveLogViewer";

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-background/98 backdrop-blur-sm">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Settings</h2>
          <p className="text-[10px] text-muted-foreground">Cores, diagnostics, and runtime details</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          className="grid size-8 place-items-center rounded-md text-muted-foreground outline-none hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <section className="space-y-3">
          <div>
            <h3 className="text-xs font-medium text-foreground">Core versions</h3>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Install, switch, or remove inactive Aether and sing-box versions while disconnected.
            </p>
          </div>
          <CoreManagerPanel />
        </section>

        <div className="my-5 h-px bg-border" />

        <section className="space-y-3">
          <div>
            <h3 className="text-xs font-medium text-foreground">Live logs</h3>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Recent bounded runtime output. Structured diagnostics restart on every app launch and
              stop writing after the session size cap is reached.
            </p>
          </div>
          <LiveLogViewer />
        </section>
      </div>
    </div>
  );
}
