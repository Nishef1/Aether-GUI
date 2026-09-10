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
  turbo: "Fastest route discovery, with the highest probe concurrency and the largest scan footprint.",
  balanced: "Good default — searches several candidates without the full cost of an exhaustive sweep.",
  thorough: "Slower, broader discovery that searches the full supported IPv4 subnet space and a larger IPv6 sample.",
  stealth: "Lowest-concurrency probing to reduce the scan footprint. It is quieter, but no scan mode can guarantee invisibility to a censor.",
  ironclad: "Opens a real tunnel through each candidate and completes a real HTTP round trip before selecting it. This is the strongest point-in-time validation, not a guarantee of future availability.",
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
