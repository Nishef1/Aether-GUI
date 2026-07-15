import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Glass } from "@samasante/liquid-glass";
import { useConnectionStore } from "@/state/connectionStore";
import type { ScanMode } from "@/types/connection";

const LABELS: Record<ScanMode, string> = {
  turbo: "Turbo",
  balanced: "Balanced",
  thorough: "Thorough",
  stealth: "Stealth",
};

const DESCRIPTIONS: Record<ScanMode, string> = {
  turbo:
    "Fastest route discovery, but the most probe traffic — an easier pattern for a censor to notice.",
  balanced: "Good default — reasonable speed without excessive probing.",
  thorough: "Slower, more exhaustive search for working routes.",
  stealth: "Slowest and most cautious — hardest for a censor to fingerprint.",
};

/** Locked outside Idle/Error, mirroring ProtocolSelect — scan mode can't
 * change mid-session either. */
export function ScanModeToggle() {
  const status = useConnectionStore((s) => s.status);
  const scanMode = useConnectionStore((s) => s.profile.scan_mode);
  const setScanMode = useConnectionStore((s) => s.setScanMode);

  const locked = status.state !== "Idle" && status.state !== "Error";

  return (
    <Glass
      className="block w-full overflow-hidden rounded-full"
      radius={999}
      optics={{ curvature: 0.28, depth: 0.85, frost: 0.5, glow: 0.2, sheen: 0.7, strength: 0.08 }}
    >
      <ToggleGroup
      type="single"
      value={scanMode}
      onValueChange={(v) => {
        if (v) setScanMode(v as ScanMode);
      }}
      disabled={locked}
      className="w-full gap-0 rounded-full bg-black/20 p-1"
    >
      {(Object.keys(LABELS) as ScanMode[]).map((mode) => (
        <Tooltip key={mode}>
          {/* asChild targets this plain span, not ToggleGroupItem directly —
           * Radix's Slot cloning onto ToggleGroupItem's own internals was
           * silently breaking its data-state/pressed rendering. */}
          <TooltipTrigger asChild>
            <span className="flex-1">
              <ToggleGroupItem
                value={mode}
                size="sm"
                aria-label={LABELS[mode]}
                className="w-full rounded-full text-muted-foreground transition-colors duration-75 data-[state=on]:bg-primary/85 data-[state=on]:text-primary-foreground"
              >
                {LABELS[mode]}
              </ToggleGroupItem>
            </span>
          </TooltipTrigger>
          <TooltipContent>{DESCRIPTIONS[mode]}</TooltipContent>
        </Tooltip>
      ))}
      </ToggleGroup>
    </Glass>
  );
}
