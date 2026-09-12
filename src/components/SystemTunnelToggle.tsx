import { useEffect } from "react";
import { LoaderCircle, RotateCcw, ShieldCheck, TriangleAlert } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { isAndroid } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useConnectionStore } from "@/state/connectionStore";
import { useSystemTunnelStore } from "@/state/systemTunnelStore";

export function SystemTunnelToggle() {
  const status = useConnectionStore((state) => state.status);
  const selection = useSystemTunnelStore((state) => state.selection);
  const loaded = useSystemTunnelStore((state) => state.loaded);
  const error = useSystemTunnelStore((state) => state.error);
  const load = useSystemTunnelStore((state) => state.load);
  const setSelection = useSystemTunnelStore((state) => state.setSelection);
  const locked = status.state !== "Idle" && status.state !== "Error";

  useEffect(() => {
    if (!isAndroid && !loaded) void load();
  }, [load, loaded]);

  if (isAndroid) {
    const ready = loaded && selection === "native" && !error;
    const Icon = error ? TriangleAlert : ready ? ShieldCheck : LoaderCircle;
    const title = error
      ? "Android device tunnel unavailable"
      : ready
        ? "Android device tunnel"
        : "Preparing Android device tunnel";
    const badge = error ? "Attention" : ready ? "Device-wide" : "Loading";

    return (
      <div className="flex flex-col gap-2">
        <div
          className={cn(
            "flex min-h-14 items-center justify-between gap-3 rounded-2xl px-3.5 py-3 ring-1",
            error
              ? "bg-status-error/[0.055] ring-status-error/15"
              : ready
                ? "bg-status-connected/[0.055] ring-status-connected/15"
                : "bg-status-connecting/[0.045] ring-status-connecting/15",
          )}
          role="status"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <Icon
              className={cn(
                "size-4 shrink-0",
                error
                  ? "text-status-error"
                  : ready
                    ? "text-status-connected"
                    : "android-connect-spin text-status-connecting",
              )}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground">{title}</p>
              <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                {error
                  ? "Aether will not start until the native VPN service is ready."
                  : ready
                    ? "All device traffic is routed through Aether; proxy-only mode stays disabled."
                    : "Loading the native VPN service before connections are allowed."}
              </p>
            </div>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full px-2.5 py-1.5 text-[10px] font-semibold ring-1",
              error
                ? "bg-status-error/10 text-status-error ring-status-error/20"
                : ready
                  ? "bg-status-connected/10 text-status-connected ring-status-connected/20"
                  : "bg-status-connecting/10 text-status-connecting ring-status-connecting/20",
            )}
          >
            {badge}
          </span>
        </div>
        {error && (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-status-error/5 px-3 py-2 text-[11px] text-status-error ring-1 ring-status-error/15">
            <span className="min-w-0 break-words" role="alert">
              {error}
            </span>
            <button
              type="button"
              className="inline-flex min-h-12 shrink-0 items-center gap-1.5 rounded-lg px-3 text-foreground ring-1 ring-white/10 outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-primary"
              onClick={() => void load()}
            >
              <RotateCcw size={13} aria-hidden="true" />
              Retry
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-14 items-center justify-between gap-4 rounded-2xl bg-black/15 px-3.5 py-3 ring-1 ring-white/8">
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground">Protect the whole device</p>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
            {loaded
              ? "Routes apps through Aether using the bundled sing-box TUN. Elevation may be required."
              : "Loading the saved system-tunnel preference…"}
          </p>
        </div>
        <Switch
          className="shrink-0"
          checked={selection === "singbox"}
          disabled={!loaded || locked}
          onCheckedChange={(enabled) => {
            void setSelection(enabled ? "singbox" : "off");
          }}
          aria-label="Enable system-wide Aether tunnel"
        />
      </div>
      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-status-error/5 px-3 py-2 text-[11px] text-status-error ring-1 ring-status-error/15">
          <span className="min-w-0 break-words" role="alert">
            {error}
          </span>
          <button
            type="button"
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-foreground ring-1 ring-white/10 outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => void load()}
          >
            <RotateCcw size={13} aria-hidden="true" />
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
