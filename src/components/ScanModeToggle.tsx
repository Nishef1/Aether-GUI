import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useConnectionStore } from "@/state/connectionStore";
import type { ScanMode } from "@/types/connection";

const LABELS: Record<ScanMode, string> = {
  turbo: "Turbo",
  balanced: "Balanced",
  thorough: "Thorough",
  stealth: "Stealth",
  ironclad: "Ironclad",
};

export function ScanModeToggle() {
  const status = useConnectionStore((s) => s.status);
  const scanMode = useConnectionStore((s) => s.profile.scan_mode);
  const setScanMode = useConnectionStore((s) => s.setScanMode);
  const locked = status.state !== "Idle" && status.state !== "Error";

  return (
    <ToggleGroup
      type="single"
      variant="accent"
      value={scanMode}
      onValueChange={(v) => {
        if (v) setScanMode(v as ScanMode);
      }}
      disabled={locked}
      aria-label="Route discovery mode"
      className="grid w-full grid-cols-5 gap-1 rounded-2xl bg-black/20 p-1 ring-1 ring-white/10"
    >
      {(Object.keys(LABELS) as ScanMode[]).map((mode) => (
        <ToggleGroupItem
          key={mode}
          value={mode}
          size="sm"
          aria-label={`${LABELS[mode]} route discovery`}
          className="min-h-12 w-full min-w-0 rounded-xl px-0.5 text-[10px] text-muted-foreground transition-[background-color,color,box-shadow] duration-100 focus-visible:ring-2 focus-visible:ring-primary sm:px-2 sm:text-xs"
        >
          <span className="min-w-0 truncate">{LABELS[mode]}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
