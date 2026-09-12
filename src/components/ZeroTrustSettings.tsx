import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useConnectionStore } from "@/state/connectionStore";

const INPUT =
  "min-h-12 w-full rounded-xl bg-black/20 px-3 text-sm text-foreground ring-1 ring-white/10 outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50";
const LABEL = "grid gap-1.5 text-[11px] text-muted-foreground";

/** Aether 1.9 Cloudflare Zero Trust enrolment controls. Credentials stay only
 * in the running WebView/backend process and are scrubbed before the
 * last-successful profile is written to disk. */
export function ZeroTrustSettings() {
  const profile = useConnectionStore((s) => s.profile);
  const status = useConnectionStore((s) => s.status);
  const setTeam = useConnectionStore((s) => s.setZeroTrustTeam);
  const setAuth = useConnectionStore((s) => s.setZeroTrustAuth);
  const setEmail = useConnectionStore((s) => s.setAccessEmail);
  const setClientId = useConnectionStore((s) => s.setAccessClientId);
  const setClientSecret = useConnectionStore((s) => s.setAccessClientSecret);
  const setToken = useConnectionStore((s) => s.setAccessToken);
  const setGateway = useConnectionStore((s) => s.setZeroTrustGateway);
  const locked = status.state !== "Idle" && status.state !== "Error";
  const enabled = profile.zero_trust_team.trim().length > 0;

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-black/10 p-3 ring-1 ring-white/10">
      <label className={LABEL}>
        <span className="font-medium text-foreground">Team name</span>
        <input
          type="text"
          value={profile.zero_trust_team}
          disabled={locked}
          onChange={(event) => setTeam(event.target.value)}
          placeholder="For example: acme"
          className={INPUT}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="zero-trust-team-help"
        />
        <span id="zero-trust-team-help" className="text-[10px] leading-4">
          Leave blank for normal consumer WARP. Adding a team enables organization enrollment.
        </span>
      </label>

      {enabled && (
        <>
          <label className={LABEL}>
            <span className="font-medium text-foreground">Sign-in method</span>
            <Select
              value={profile.zero_trust_auth}
              onValueChange={setAuth}
              disabled={locked}
            >
              <SelectTrigger className="min-h-12 w-full text-sm" aria-label="Zero Trust sign-in method">
                <SelectValue placeholder="Sign-in method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem className="min-h-11" value="email">
                  Email one-time code
                </SelectItem>
                <SelectItem className="min-h-11" value="service">
                  Service token
                </SelectItem>
                <SelectItem className="min-h-11" value="token">
                  Existing access token
                </SelectItem>
              </SelectContent>
            </Select>
          </label>

          {profile.zero_trust_auth === "email" && (
            <label className={LABEL}>
              <span className="font-medium text-foreground">Enrollment email</span>
              <input
                type="email"
                inputMode="email"
                value={profile.access_email}
                disabled={locked}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                className={INPUT}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="email"
              />
            </label>
          )}

          {profile.zero_trust_auth === "service" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={LABEL}>
                <span className="font-medium text-foreground">Client ID</span>
                <input
                  type="text"
                  value={profile.access_client_id}
                  disabled={locked}
                  onChange={(event) => setClientId(event.target.value)}
                  placeholder="Service-token client ID"
                  className={INPUT}
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label className={LABEL}>
                <span className="font-medium text-foreground">Client secret</span>
                <input
                  type="password"
                  value={profile.access_client_secret}
                  disabled={locked}
                  onChange={(event) => setClientSecret(event.target.value)}
                  placeholder="Service-token secret"
                  className={INPUT}
                  autoComplete="off"
                />
              </label>
            </div>
          )}

          {profile.zero_trust_auth === "token" && (
            <label className={LABEL}>
              <span className="font-medium text-foreground">Enrollment access token</span>
              <input
                type="password"
                value={profile.access_token}
                disabled={locked}
                onChange={(event) => setToken(event.target.value)}
                placeholder="JWT"
                className={INPUT}
                autoComplete="off"
              />
            </label>
          )}

          <div className="flex min-h-12 items-center justify-between gap-3">
            <div>
              <span className="block text-xs text-foreground">Use organization Gateway proxy</span>
              <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                Your organization may filter and log HTTP/HTTPS traffic through this extra hop.
              </span>
            </div>
            <Switch
              checked={profile.zero_trust_gateway}
              onCheckedChange={setGateway}
              disabled={locked}
              aria-label="Use organization Gateway proxy"
            />
          </div>
          <p className="rounded-xl bg-white/[0.025] px-3 py-2 text-[10px] leading-4 text-muted-foreground ring-1 ring-white/8">
            Credentials are session-only and are never written to the saved connection profile.
          </p>
        </>
      )}
    </div>
  );
}
