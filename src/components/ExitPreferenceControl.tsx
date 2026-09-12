import { Gamepad2, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useExitPolicyStore } from "@/state/exitPolicyStore";

const OPTIONS = [
  {
    id: "low-latency" as const,
    label: "Gaming / Fast",
    icon: Gamepad2,
    description: "Accepts the first healthy route. Exit country does not matter.",
  },
  {
    id: "privacy" as const,
    label: "Privacy",
    icon: ShieldCheck,
    description: "Retries for a preferred non-Iran exit when WARP makes one available.",
  },
];

export function ExitPreferenceControl({ disabled = false }: { disabled?: boolean }) {
  const preference = useExitPolicyStore((state) => state.preference);
  const setPreference = useExitPolicyStore((state) => state.setPreference);

  return (
    <fieldset className="grid gap-1.5" disabled={disabled} aria-describedby="connection-goal-help">
      <legend className="text-[11px] font-medium text-muted-foreground">Connection goal</legend>
      <div className="grid grid-cols-2 gap-2">
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          const selected = option.id === preference;
          return (
            <label
              key={option.id}
              className={cn("relative block", disabled ? "cursor-not-allowed" : "cursor-pointer")}
            >
              <input
                type="radio"
                name="connection-goal"
                value={option.id}
                checked={selected}
                onChange={() => setPreference(option.id)}
                className="peer sr-only"
              />
              <span
                className={cn(
                  "block min-h-12 rounded-xl px-3 py-2 text-left ring-1 outline-none transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-primary",
                  selected
                    ? "bg-primary/10 text-foreground ring-primary/35"
                    : "bg-black/15 text-muted-foreground ring-white/8 hover:bg-white/5",
                  disabled && "opacity-50",
                )}
              >
                <span className="flex items-center gap-2 text-xs font-semibold">
                  <Icon
                    size={14}
                    className={selected ? "text-primary" : undefined}
                    aria-hidden="true"
                  />
                  {option.label}
                </span>
                <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">
                  {option.description}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      <p id="connection-goal-help" className="px-1 text-[10px] leading-4 text-muted-foreground">
        Gaming / Fast is reachability-first and may keep an Iran exit if it is the first healthy,
        low-latency route. Privacy spends extra time trying for a verified non-Iran exit; WARP
        cannot guarantee a specific country.
      </p>
    </fieldset>
  );
}
