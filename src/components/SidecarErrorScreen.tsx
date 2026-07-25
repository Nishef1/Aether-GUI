import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  message: string;
  onRetry: () => void;
}

/** Full-screen fallback shown when no usable managed or bundled Aether core
 * can be launched. Normal network/tunnel failures remain on the main screen. */
export function SidecarErrorScreen({ message, onRetry }: Props) {
  useEffect(() => {
    void invoke("sync_tray_state", { state: "Error" }).catch(() => {
      // The visible error remains authoritative if tray rendering is unavailable.
    });
  }, []);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <AlertTriangle size={40} className="text-status-error" />
      <h1 className="text-base font-medium text-foreground">Aether engine failed to start</h1>
      <p className="max-w-xs font-mono text-xs text-muted-foreground">{message}</p>
      <Button variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
