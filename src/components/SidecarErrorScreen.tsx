import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  message: string;
  onRetry: () => void;
}

/** Full-screen fallback shown when the bundled Aether binary itself can't
 * run — structurally different from a normal connection error, since the
 * connect button would be meaningless to show at all in this state. */
export function SidecarErrorScreen({ message, onRetry }: Props) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 overflow-y-auto p-6 text-center">
      <div
        className="grid size-14 shrink-0 place-items-center rounded-2xl bg-status-error/8 text-status-error ring-1 ring-status-error/20"
        aria-hidden="true"
      >
        <AlertTriangle size={28} />
      </div>
      <div role="alert" className="grid max-w-sm gap-2">
        <h1 className="text-base font-semibold text-foreground">Aether engine failed to start</h1>
        <p className="text-sm leading-5 text-muted-foreground">
          The connection engine did not start correctly. Retry once; if it fails again, restart the
          app before reconnecting.
        </p>
      </div>
      <Button variant="outline" className="min-h-12 min-w-28 px-4" onClick={onRetry}>
        Retry
      </Button>
      <details className="w-full max-w-sm rounded-xl bg-black/15 px-3 py-2 text-left ring-1 ring-white/8">
        <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
          Technical details
        </summary>
        <p className="mt-2 break-words font-mono text-[11px] leading-5 text-muted-foreground">
          {message}
        </p>
      </details>
    </div>
  );
}
