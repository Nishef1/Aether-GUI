import { useConnectionStore } from "@/state/connectionStore";
import { Switch } from "@/components/ui/switch";
import { isAndroid } from "@/lib/platform";

const DEFAULT_PORT = "1819";
const LOOPBACK = "127.0.0.1";
const ANY = "0.0.0.0";

function splitAddr(addr: string): { host: string; port: string } {
  const last = addr.lastIndexOf(":");
  if (last === -1) return { host: LOOPBACK, port: addr || DEFAULT_PORT };
  return { host: addr.slice(0, last) || LOOPBACK, port: addr.slice(last + 1) || DEFAULT_PORT };
}

export function BindAddressField() {
  const bind = useConnectionStore((s) => s.profile.bind_address);
  const setBindAddress = useConnectionStore((s) => s.setBindAddress);
  const status = useConnectionStore((s) => s.status);
  const locked = status.state !== "Idle" && status.state !== "Error";
  const { host, port } = splitAddr(bind);
  const effectiveHost = isAndroid ? LOOPBACK : host;
  const lan = !isAndroid && host === ANY;

  const rebuild = (h: string, p: string) =>
    setBindAddress(`${isAndroid ? LOOPBACK : h}:${p || DEFAULT_PORT}`);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <input
        type="text"
        inputMode="numeric"
        value={port}
        disabled={locked}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, 5);
          rebuild(effectiveHost, v);
        }}
        onBlur={() => {
          const n = Number(port);
          if (!port || n < 1 || n > 65535) rebuild(effectiveHost, DEFAULT_PORT);
        }}
        className="min-h-12 w-full rounded-xl bg-black/20 px-3 text-center text-sm text-foreground ring-1 ring-white/10 outline-none focus:ring-primary disabled:opacity-50 sm:w-24"
        aria-label="SOCKS5 port"
      />

      {isAndroid ? (
        <div className="flex min-h-12 items-center justify-between gap-3 rounded-xl bg-white/[0.025] px-3 ring-1 ring-white/8 sm:flex-1">
          <div>
            <span className="block text-xs text-foreground">App-local listener</span>
            <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
              Android keeps SOCKS on 127.0.0.1 so other devices cannot reach it.
            </span>
          </div>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">127.0.0.1</span>
        </div>
      ) : (
        <div className="flex min-h-12 items-center justify-between gap-3 sm:justify-end">
          <div>
            <span className="block text-xs text-foreground">Allow LAN connections</span>
            {lan && (
              <span className="mt-0.5 block text-[10px] leading-4 text-status-connecting">
                Unauthenticated proxy will be reachable from your local network.
              </span>
            )}
          </div>
          <Switch
            checked={lan}
            onCheckedChange={(on) => rebuild(on ? ANY : LOOPBACK, port)}
            disabled={locked}
            aria-label="Allow connections from the LAN"
          />
        </div>
      )}
    </div>
  );
}
