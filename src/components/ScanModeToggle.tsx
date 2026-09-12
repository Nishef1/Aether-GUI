import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useConnectionStore } from "@/state/connectionStore";
import type { ScanMode } from "@/types/connection";

const LABELS: Record<ScanMode, string> = {
  turbo: "Turbo",
  balanced: "Balanced",
  thorough: "Thorough",
  stealth: "Stealth",
  ironclad: "Ironclad",
};

const DESCRIPTIONS: Record<ScanMode, string> = {
  turbo:
    "Fastest first-healthy policy. Uses fail-fast startup/liveness timing, no artificial probe jitter, and moves Automatic to the next carrier sooner.",
  balanced:
    "General-purpose discovery with moderate failure tolerance and light probe smoothing. It compares more candidates when Turbo misses.",
  thorough:
    "Broader route discovery with longer startup/liveness windows and a shorter failed-endpoint cooldown so deep scans can reconsider the candidate pool.",
  stealth:
    "Quiet discovery only: lower concurrency, stronger pre-connect probe jitter, and less scan/reconnect churn. It reduces how noisy gateway discovery looks to the access network; it does not hide the final VPN exit, browser timezone, latency, or website-facing TCP flow.",
  ironclad:
    "Validates candidates with real data-plane traffic and uses bounded, tolerant liveness timing. Strong point-in-time verification, not a guarantee of future availability or website invisibility.",
};

export function ScanModeToggle() {
  const status = useConnectionStore((s) => s.status);
  const scanMode = useConnectionStore((s) => s.profile.scan_mode);
  const setScanMode = useConnectionStore((s) => s.setScanMode);
  const locked = status.state !== "Idle" && status.state !== "Error";

  return (
    <ToggleGroup
      type="single"
      value={scanMode}
      onValueChange={(v) => {
        if (v) setScanMode(v as ScanMode);
      }}
      disabled={locked}
      className="w-full gap-0 rounded-2xl bg-black/20 p-1 ring-1 ring-white/10"
    >
      {(Object.keys(LABELS) as ScanMode[]).map((mode) => (
        <Tooltip key={mode}>
          <TooltipTrigger asChild>
            <span className="flex-1">
              <ToggleGroupItem
                value={mode}
                size="sm"
                aria-label={LABELS[mode]}
                className="min-h-12 w-full rounded-xl px-1 text-[11px] text-muted-foreground transition-colors duration-75 data-[state=on]:bg-primary/85 data-[state=on]:text-primary-foreground sm:px-2 sm:text-xs"
              >
                {LABELS[mode]}
              </ToggleGroupItem>
            </span>
          </TooltipTrigger>
          <TooltipContent>{DESCRIPTIONS[mode]}</TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  );
}
