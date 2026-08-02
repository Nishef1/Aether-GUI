import { Switch } from "@/components/ui/switch";
import { useConnectionStore } from "@/state/connectionStore";
import type { ConnectionProfile, PerfProfile } from "@/types/connection";

function TextField({
  label,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
      {label}
      <input
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 rounded-md bg-black/20 px-2 font-mono text-xs text-foreground ring-1 ring-white/10 outline-none focus:ring-primary disabled:opacity-50"
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
      {label}
      <input
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) =>
          onChange(Math.min(max, Math.max(min, Number(event.target.value) || min)))
        }
        className="h-8 rounded-md bg-black/20 px-2 font-mono text-xs text-foreground ring-1 ring-white/10 outline-none focus:ring-primary disabled:opacity-50"
      />
    </label>
  );
}

function BooleanField({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs text-foreground">{label}</p>
        <p className="text-[10px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

export function CoreAdvancedSettings() {
  const profile = useConnectionStore((state) => state.profile);
  const status = useConnectionStore((state) => state.status);
  const setField = useConnectionStore((state) => state.setProfileField);
  const locked = status.state !== "Idle" && status.state !== "Error";
  const masqueFamily = profile.protocol === "auto" || profile.protocol === "masque";
  const wireGuardFamily = profile.protocol === "wireguard" || profile.protocol === "gool";

  const set = <K extends keyof ConnectionProfile>(field: K, value: ConnectionProfile[K]) =>
    setField(field, value);

  return (
    <details className="rounded-md bg-black/10 p-3 ring-1 ring-white/10">
      <summary className="cursor-pointer select-none text-xs font-medium text-foreground">
        Expert core controls
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          Performance profile
          <select
            value={profile.perf_profile}
            disabled={locked}
            onChange={(event) => set("perf_profile", event.target.value as PerfProfile)}
            className="h-8 rounded-md bg-surface-2 px-2 text-xs text-foreground ring-1 ring-white/10 outline-none focus:ring-primary disabled:opacity-50"
          >
            <option value="auto">Auto</option>
            <option value="low">Low power</option>
            <option value="medium">Balanced resources</option>
            <option value="high">High performance</option>
          </select>
        </label>

        <TextField
          label="Forced peer (ip:port)"
          value={profile.peer}
          placeholder="Automatic scan"
          disabled={locked}
          onChange={(value) => set("peer", value)}
        />

        {profile.protocol === "gool" && (
          <TextField
            label="Outer WireGuard peer"
            value={profile.wg_peer}
            placeholder="Automatic outer peer"
            disabled={locked}
            onChange={(value) => set("wg_peer", value)}
          />
        )}

        {masqueFamily && (
          <>
            <TextField
              label="HTTP/2 peer"
              value={profile.h2_peer}
              placeholder="Automatic H2 peer"
              disabled={locked || !profile.masque_http2}
              onChange={(value) => set("h2_peer", value)}
            />
            <TextField
              label="Encrypted Client Hello"
              value={profile.ech}
              placeholder="Empty, auto, or base64 ECH config"
              disabled={locked}
              onChange={(value) => set("ech", value)}
            />
            <BooleanField
              label="Fragment HTTP/2 ClientHello"
              description="Splits the TLS ClientHello to resist simple DPI on TCP networks."
              checked={profile.fragment}
              disabled={locked || !profile.masque_http2}
              onChange={(value) => set("fragment", value)}
            />
            {profile.fragment && (
              <div className="grid grid-cols-2 gap-2">
                <TextField
                  label="Fragment size"
                  value={profile.fragment_size}
                  placeholder="16-32"
                  disabled={locked || !profile.masque_http2}
                  onChange={(value) => set("fragment_size", value)}
                />
                <TextField
                  label="Fragment delay ms"
                  value={profile.fragment_delay}
                  placeholder="2-10"
                  disabled={locked || !profile.masque_http2}
                  onChange={(value) => set("fragment_delay", value)}
                />
              </div>
            )}
          </>
        )}

        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Validation seconds"
            value={profile.validate_secs}
            min={1}
            max={120}
            disabled={locked}
            onChange={(value) => set("validate_secs", value)}
          />
          <NumberField
            label="Reconnect delay"
            value={profile.reconnect_secs}
            min={1}
            max={60}
            disabled={locked}
            onChange={(value) => set("reconnect_secs", value)}
          />
        </div>

        {wireGuardFamily && (
          <>
            <NumberField
              label="WireGuard keepalive seconds"
              value={profile.keepalive}
              min={1}
              max={120}
              disabled={locked}
              onChange={(value) => set("keepalive", value)}
            />
            <BooleanField
              label="Disable profile retry"
              description="Do not retry alternate WireGuard obfuscation profiles after a failed scan."
              checked={profile.no_profile_retry}
              disabled={locked}
              onChange={(value) => set("no_profile_retry", value)}
            />
          </>
        )}

        <TextField
          label="TLS key-share groups"
          value={profile.tls_groups}
          placeholder="P-256:X25519:P-384"
          disabled={locked}
          onChange={(value) => set("tls_groups", value)}
        />

        <BooleanField
          label="Skip end-to-end data check"
          description="Unsafe troubleshooting option. A local handshake may succeed while real internet traffic remains blocked."
          checked={profile.no_data_check}
          disabled={locked}
          onChange={(value) => set("no_data_check", value)}
        />
      </div>
    </details>
  );
}
