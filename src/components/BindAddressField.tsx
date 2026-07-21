import { useConnectionStore } from "@/state/connectionStore";

const DEFAULT_PORT = "1819";
const LOOPBACK = "127.0.0.1";

function portFromAddress(addr: string): string {
  const last = addr.lastIndexOf(":");
  if (last === -1) return DEFAULT_PORT;
  return addr.slice(last + 1) || DEFAULT_PORT;
}

export function BindAddressField() {
  const bind = useConnectionStore((s) => s.profile.bind_address);
  const setBindAddress = useConnectionStore((s) => s.setBindAddress);
  const status = useConnectionStore((s) => s.status);
  const locked = status.state !== "Idle" && status.state !== "Error";
  const port = portFromAddress(bind);

  const setPort = (value: string) => setBindAddress(`${LOOPBACK}:${value || DEFAULT_PORT}`);

  return (
    <div className="flex items-center justify-between gap-3">
      <input
        type="text"
        inputMode="numeric"
        value={port}
        disabled={locked}
        onChange={(e) => setPort(e.target.value.replace(/\D/g, "").slice(0, 5))}
        onBlur={() => {
          const n = Number(port);
          if (!port || n < 1 || n > 65535) setPort(DEFAULT_PORT);
        }}
        className="h-8 w-20 rounded-md bg-black/20 px-2 text-center text-xs text-foreground ring-1 ring-white/10 outline-none focus:ring-primary disabled:opacity-50"
        aria-label="SOCKS5 port"
      />
      <span className="text-xs text-muted-foreground">127.0.0.1 · local only</span>
    </div>
  );
}
