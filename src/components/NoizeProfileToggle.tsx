import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useConnectionStore } from "@/state/connectionStore";
import type { NoizeProfile } from "@/types/connection";

const OPTIONS: readonly NoizeProfile[] = [
  "firewall",
  "balanced",
  "light",
  "gfw",
  "aggressive",
  "off",
];

const LABELS: Record<NoizeProfile, string> = {
  off: "Off",
  light: "Light",
  firewall: "Firewall",
  balanced: "Balanced",
  gfw: "GFW",
  aggressive: "Aggressive",
};

const DESCRIPTIONS: Record<NoizeProfile, string> = {
  off: "No cover traffic. Useful on open networks or while troubleshooting.",
  light: "Low-overhead cover traffic with small randomized packets and minimal setup delay.",
  firewall:
    "Conservative, independently tuned cover traffic for restrictive firewalls; the recommended MASQUE default.",
  balanced:
    "Moderate packet-size and signature variation with practical overhead; the WireGuard default.",
  gfw: "A separate heavier timing and signature profile for networks with aggressive filtering or DPI. It does not guarantee evasion.",
  aggressive:
    "Largest built-in cover-traffic budget and signature set. Use only when lighter profiles fail because setup time and battery cost are higher.",
};

export function NoizeProfileToggle() {
  const status = useConnectionStore((state) => state.status);
  const protocol = useConnectionStore((state) => state.profile.protocol);
  const masqueNoize = useConnectionStore((state) => state.profile.masque_noize);
  const wgNoize = useConnectionStore((state) => state.profile.wg_noize);
  const setMasqueNoize = useConnectionStore((state) => state.setMasqueNoize);
  const setWgNoize = useConnectionStore((state) => state.setWgNoize);
  const locked = status.state !== "Idle" && status.state !== "Error";
  const isMasque = protocol === "auto" || protocol === "masque";
  const selected = isMasque ? masqueNoize : wgNoize;

  return (
    <div className="grid gap-1.5">
      <ToggleGroup
        type="single"
        value={selected}
        onValueChange={(value) => {
          if (!value) return;
          if (isMasque) setMasqueNoize(value as NoizeProfile);
          else setWgNoize(value as NoizeProfile);
        }}
        disabled={locked}
        aria-label="Obfuscation profile"
        className="w-full flex-wrap gap-1 rounded-2xl bg-black/20 p-1 ring-1 ring-white/10"
      >
        {OPTIONS.map((profile) => (
          <Tooltip key={profile}>
            <TooltipTrigger asChild>
              <ToggleGroupItem
                value={profile}
                size="sm"
                aria-label={LABELS[profile]}
                className="min-h-12 min-w-[30%] flex-1 rounded-xl px-1 text-[11px] text-muted-foreground transition-colors duration-75 focus-visible:ring-2 focus-visible:ring-primary data-[state=on]:bg-primary/85 data-[state=on]:text-primary-foreground sm:px-2 sm:text-xs"
              >
                {LABELS[profile]}
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent className="max-w-72 leading-relaxed">
              {DESCRIPTIONS[profile]}
            </TooltipContent>
          </Tooltip>
        ))}
      </ToggleGroup>
      <p className="px-1 text-[10px] leading-4 text-muted-foreground">
        {DESCRIPTIONS[selected]}
      </p>
    </div>
  );
}
