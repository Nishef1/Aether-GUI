import { Switch } from "@/components/ui/switch";
import { useConnectionStore } from "@/state/connectionStore";
import type { ConnectionProfile, H2MaskMode, PerfProfile } from "@/types/connection";

function TextField({
  label,
  description,
  value,
  placeholder,
  disabled,
  type = "text",
  onChange,
}: {
  label: string;
  description?: string;
  value: string;
  placeholder?: string;
  disabled: boolean;
  type?: "text" | "password";
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{label}</span>
      {description && <span className="text-[11px] leading-4">{description}</span>}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 rounded-xl bg-black/20 px-3 font-mono text-xs text-foreground ring-1 ring-white/10 outline-none transition focus:ring-primary disabled:opacity-50"
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
  const commit = (input: HTMLInputElement) => {
    const raw = input.value.trim();
    const parsed = Number(raw);
    const next =
      raw.length === 0 || !Number.isFinite(parsed)
        ? value
        : Math.min(max, Math.max(min, Math.round(parsed)));
    input.value = String(next);
    if (next !== value) onChange(next);
  };

  return (
    <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{label}</span>
      <input
        key={value}
        type="number"
        inputMode="numeric"
        defaultValue={value}
        min={min}
        max={max}
        disabled={disabled}
        onBlur={(event) => commit(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.currentTarget.value = String(value);
            event.currentTarget.blur();
          }
        }}
        className="min-h-11 rounded-xl bg-black/20 px-3 font-mono text-xs text-foreground ring-1 ring-white/10 outline-none focus:ring-primary disabled:opacity-50"
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
    <div className="flex min-h-12 items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs font-medium text-foreground">{label}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{description}</p>
      </div>
      <Switch
        className="shrink-0"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-label={label}
      />
    </div>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        {label}
      </span>
      <div className="h-px flex-1 bg-white/8" />
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
  const gool = profile.protocol === "gool";
  const h2Mask: H2MaskMode = profile.masque_mask ?? (profile.fragment ? "legacy" : "off");

  const set = <K extends keyof ConnectionProfile>(field: K, value: ConnectionProfile[K]) =>
    setField(field, value);

  const setH2Mask = (mode: H2MaskMode) => {
    set("masque_mask", mode);
    // Keep the old boolean coherent for saved-profile compatibility. New
    // deterministic modes are selected by the explicit mask environment value.
    set("fragment", mode === "legacy");
  };

  return (
    <details className="group rounded-2xl bg-black/15 p-3.5 ring-1 ring-white/10">
      <summary className="cursor-pointer list-none select-none text-xs font-semibold text-foreground marker:hidden">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p>Aether 1.9 expert controls</p>
            <p className="mt-1 text-[11px] font-normal leading-4 text-muted-foreground">
              Chaining, manual endpoints, validation and recovery behavior.
            </p>
          </div>
          <span className="text-[10px] text-muted-foreground group-open:hidden">Open</span>
          <span className="hidden text-[10px] text-muted-foreground group-open:inline">Close</span>
        </div>
      </summary>

      <div className="mt-4 flex flex-col gap-4">
        <Divider label="Proxy & chaining" />
        <TextField
          label="Upstream proxy"
          description="Chains Aether behind an existing SOCKS5 or HTTP proxy. Credentials are session-only and are not saved."
          value={profile.upstream}
          placeholder="socks5://127.0.0.1:1080"
          disabled={locked}
          type="password"
          onChange={(value) => set("upstream", value)}
        />
        <TextField
          label="HTTP CONNECT listener"
          description="Optional local HTTP proxy served by the same Aether tunnel. Keep it on loopback unless you intentionally share it."
          value={profile.http_proxy}
          placeholder="127.0.0.1:1820"
          disabled={locked}
          onChange={(value) => set("http_proxy", value)}
        />

        <Divider label="Endpoints" />
        {!gool && (
          <TextField
            label="Forced peer"
            description="Skips endpoint discovery and forces a single ip:port. Leave empty for normal scanning."
            value={profile.peer}
            placeholder="Automatic scan"
            disabled={locked}
            onChange={(value) => set("peer", value)}
          />
        )}
        {gool && (
          <>
            <TextField
              label="WARP-in-WARP outer peer"
              description="The first hop your network sees. Aether 1.9 can scan it when left empty."
              value={profile.wiw_outer}
              placeholder="162.159.192.1:2408"
              disabled={locked || profile.wiw_scan}
              onChange={(value) => set("wiw_outer", value)}
            />
            <TextField
              label="WARP-in-WARP inner peer"
              description="Second hop reached through the outer tunnel. It must differ from the outer address."
              value={profile.wiw_inner}
              placeholder="188.114.96.1:2408"
              disabled={locked || profile.wiw_scan}
              onChange={(value) => set("wiw_inner", value)}
            />
            <BooleanField
              label="Scan both WARP-in-WARP hops"
              description="Ignores stored/manual WARP-in-WARP endpoints and discovers two fresh hops."
              checked={profile.wiw_scan}
              disabled={locked}
              onChange={(value) => set("wiw_scan", value)}
            />
          </>
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
              description="Use auto or a base64 ECH config only when the network requires it."
              value={profile.ech}
              placeholder="Empty / auto / base64"
              disabled={locked}
              onChange={(value) => set("ech", value)}
            />
            <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">HTTP/2 ClientHello mask</span>
              <span className="text-[11px] leading-4">
                Off is safest. Deterministic modes alter only ClientHello TCP write boundaries; Patterniha is experimental and never selected automatically.
              </span>
              <select
                value={h2Mask}
                disabled={locked || !profile.masque_http2}
                onChange={(event) => setH2Mask(event.target.value as H2MaskMode)}
                className="min-h-11 rounded-xl bg-surface-2 px-3 text-xs text-foreground ring-1 ring-white/10 outline-none focus:ring-primary disabled:opacity-50"
              >
                <option value="off">Off</option>
                <option value="legacy">Legacy random TCP fragment</option>
                <option value="clienthello">Deterministic ClientHello split</option>
                <option value="patterniha">Patterniha-inspired (experimental)</option>
              </select>
            </label>
            {h2Mask === "legacy" && (
              <div className="grid grid-cols-2 gap-2">
                <TextField
                  label="Fragment size"
                  value={profile.fragment_size}
                  placeholder="16-32"
                  disabled={locked || !profile.masque_http2}
                  onChange={(value) => set("fragment_size", value)}
                />
                <TextField
                  label="Delay (ms)"
                  value={profile.fragment_delay}
                  placeholder="2-10"
                  disabled={locked || !profile.masque_http2}
                  onChange={(value) => set("fragment_delay", value)}
                />
              </div>
            )}
          </>
        )}

        <Divider label="Reliability" />
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Validate (s)"
            value={profile.validate_secs}
            min={1}
            max={120}
            disabled={locked}
            onChange={(value) => set("validate_secs", value)}
          />
          <NumberField
            label="Reconnect (s)"
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
              label="WireGuard keepalive (s)"
              value={profile.keepalive}
              min={1}
              max={120}
              disabled={locked}
              onChange={(value) => set("keepalive", value)}
            />
            <BooleanField
              label="Disable WireGuard profile retry"
              description="Stops Aether from trying alternate obfuscation profiles after a failed WireGuard scan."
              checked={profile.no_profile_retry}
              disabled={locked}
              onChange={(value) => set("no_profile_retry", value)}
            />
          </>
        )}

        <BooleanField
          label="Domain sniffing behind TUN"
          description="Keeps domain routing rules working when the TUN hands Aether only an IP address. Recommended on."
          checked={profile.route_sniff}
          disabled={locked}
          onChange={(value) => set("route_sniff", value)}
        />
        {profile.route_sniff && (
          <NumberField
            label="Sniff timeout (ms)"
            value={profile.route_sniff_ms}
            min={50}
            max={5000}
            disabled={locked}
            onChange={(value) => set("route_sniff_ms", value)}
          />
        )}
        <BooleanField
          label="Auto-repair rejected identity"
          description="Lets Aether provision a fresh identity when Cloudflare rejects the saved one. Recommended on."
          checked={profile.auto_reprovision}
          disabled={locked}
          onChange={(value) => set("auto_reprovision", value)}
        />

        <Divider label="Resources & diagnostics" />
        <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Performance profile</span>
          <select
            value={profile.perf_profile}
            disabled={locked}
            onChange={(event) => set("perf_profile", event.target.value as PerfProfile)}
            className="min-h-11 rounded-xl bg-surface-2 px-3 text-xs text-foreground ring-1 ring-white/10 outline-none focus:ring-primary disabled:opacity-50"
          >
            <option value="auto">Auto</option>
            <option value="low">Low power</option>
            <option value="medium">Balanced resources</option>
            <option value="high">High performance</option>
          </select>
        </label>
        <TextField
          label="TLS key-share groups"
          value={profile.tls_groups}
          placeholder="P-256:X25519:P-384"
          disabled={locked}
          onChange={(value) => set("tls_groups", value)}
        />
        <BooleanField
          label="Skip end-to-end data check"
          description="Troubleshooting only. A handshake can succeed while real internet traffic is still blocked."
          checked={profile.no_data_check}
          disabled={locked}
          onChange={(value) => set("no_data_check", value)}
        />
      </div>
    </details>
  );
}
