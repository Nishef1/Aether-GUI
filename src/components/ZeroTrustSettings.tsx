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
  "min-h-12 w-full rounded-xl bg-black/20 px-3 text-sm text-foreground ring-1 ring-white/10 outline-none focus:ring-primary disabled:opacity-50";

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
      <input
        type="text"
        value={profile.zero_trust_team}
        disabled={locked}
        onChange={(e) => setTeam(e.target.value)}
        placeholder="Team name (for example: acme)"
        className={INPUT}
        autoCapitalize="none"
        autoCorrect="off"
        aria-label="Cloudflare Zero Trust team name"
      />
      {enabled && (
        <>
          <Select
            value={profile.zero_trust_auth}
            onValueChange={setAuth}
            disabled={locked}
          >
            <SelectTrigger className="min-h-12 w-full text-sm">
              <SelectValue placeholder="Sign-in method" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem className="min-h-11" value="email">Email one-time code</SelectItem>
              <SelectItem className="min-h-11" value="service">Service token</SelectItem>
              <SelectItem className="min-h-11" value="token">Existing access token</SelectItem>
            </SelectContent>
          </Select>
          {profile.zero_trust_auth === "email" && (
            <input
              type="email"
              inputMode="email"
              value={profile.access_email}
              disabled={locked}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email for the one-time code"
              className={INPUT}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="email"
              aria-label="Zero Trust email"
            />
          )}
          {profile.zero_trust_auth === "service" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                type="text"
                value={profile.access_client_id}
                disabled={locked}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="Client ID"
                className={INPUT}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                aria-label="Access service-token client ID"
              />
              <input
                type="password"
                value={profile.access_client_secret}
                disabled={locked}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="Client secret"
                className={INPUT}
                autoComplete="off"
                aria-label="Access service-token client secret"
              />
            </div>
          )}
          {profile.zero_trust_auth === "token" && (
            <input
              type="password"
              value={profile.access_token}
              disabled={locked}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Enrollment access token (JWT)"
              className={INPUT}
              autoComplete="off"
              aria-label="Zero Trust enrollment access token"
            />
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
          <p className="text-[10px] leading-4 text-muted-foreground">
            Credentials are session-only and are never written to the saved connection profile.
          </p>
        </>
      )}
    </div>
  );
}
