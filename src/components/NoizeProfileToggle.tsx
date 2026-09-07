import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useConnectionStore } from "@/state/connectionStore";
import type { NoizeProfile } from "@/types/connection";

const OPTIONS: Array<{ value: NoizeProfile; label: string }> = [
  { value: "off", label: "Off" },
  { value: "light", label: "Light" },
  { value: "firewall", label: "Firewall" },
  { value: "balanced", label: "Balanced" },
  { value: "gfw", label: "GFW" },
  { value: "aggressive", label: "Aggressive" },
];

/** Aether 1.9 accepts the same six noize profiles for every transport. The
 * GUI keeps separate remembered values for MASQUE and WireGuard/gool so
 * switching protocol does not destroy the user's last tuning choice. */
export function NoizeProfileToggle() {
  const status = useConnectionStore((state) => state.status);
  const protocol = useConnectionStore((state) => state.profile.protocol);
  const masqueNoize = useConnectionStore((state) => state.profile.masque_noize);
  const wgNoize = useConnectionStore((state) => state.profile.wg_noize);
  const setMasqueNoize = useConnectionStore((state) => state.setMasqueNoize);
  const setWgNoize = useConnectionStore((state) => state.setWgNoize);
  const locked = status.state !== "Idle" && status.state !== "Error";
  const masque = protocol === "auto" || protocol === "masque";
  const value = masque ? masqueNoize : wgNoize;

  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (!next) return;
        if (masque) setMasqueNoize(next as NoizeProfile);
        else setWgNoize(next as NoizeProfile);
      }}
      disabled={locked}
      className="grid w-full grid-cols-3 gap-1 rounded-xl bg-black/20 p-1 ring-1 ring-white/10"
      aria-label="Traffic obfuscation profile"
    >
      {OPTIONS.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          size="sm"
          aria-label={option.label}
          className="min-h-10 w-full rounded-lg px-2 text-[11px] text-muted-foreground transition-colors duration-75 data-[state=on]:bg-primary/90 data-[state=on]:text-primary-foreground"
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
