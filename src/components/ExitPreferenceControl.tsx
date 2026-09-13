import { Gamepad2, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useExitPolicyStore } from "@/state/exitPolicyStore";

const OPTIONS = [
  { id: "low-latency" as const, label: "Gaming / Fast", icon: Gamepad2 },
  { id: "privacy" as const, label: "Privacy", icon: ShieldCheck },
];

const HELP = {
  "low-latency": "First healthy low-latency route wins; exit country is not enforced.",
  privacy: "Retries for a preferred non-Iran exit when available; WARP cannot guarantee a country.",
} as const;

export function ExitPreferenceControl({ disabled = false }: { disabled?: boolean }) {
  const preference = useExitPolicyStore((state) => state.preference);
  const setPreference = useExitPolicyStore((state) => state.setPreference);

  return (
    <fieldset
      className="grid min-w-0 gap-1.5"
      disabled={disabled}
      aria-describedby="connection-goal-help"
    >
      <legend className="text-[11px] font-medium text-muted-foreground">Connection goal</legend>
      <div className="grid min-w-0 grid-cols-1 gap-2 min-[360px]:grid-cols-2">
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          const selected = option.id === preference;
          return (
            <label
              key={option.id}
              className={cn(
                "relative block min-w-0",
                disabled ? "cursor-not-allowed" : "cursor-pointer",
              )}
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
                  "flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-xl px-3 text-xs font-semibold ring-1 outline-none transition-[background-color,color,box-shadow] duration-100 peer-focus-visible:ring-2 peer-focus-visible:ring-primary",
                  selected
                    ? "bg-primary text-primary-foreground ring-primary shadow-sm"
                    : "bg-black/15 text-muted-foreground ring-white/8 hover:bg-white/5",
                  disabled && "opacity-50",
                )}
              >
                <Icon size={14} className="shrink-0" aria-hidden="true" />
                <span className="min-w-0 truncate">{option.label}</span>
              </span>
            </label>
          );
        })}
      </div>
      <p id="connection-goal-help" className="px-1 text-[10px] leading-4 text-muted-foreground">
        {HELP[preference]}
      </p>
    </fieldset>
  );
}
