import { useState } from "react"
import { useConnectionStore } from "@/state/connectionStore"

const DEFAULT_PORT = "1819"
const LOOPBACK = "127.0.0.1"

function portFromAddress(addr: string): string {
  const last = addr.lastIndexOf(":")
  if (last === -1) return DEFAULT_PORT
  return addr.slice(last + 1) || DEFAULT_PORT
}

function normalizePort(value: string): string {
  const port = Number(value)
  return value && Number.isInteger(port) && port >= 1 && port <= 65535
    ? String(port)
    : DEFAULT_PORT
}

export function BindAddressField() {
  const bind = useConnectionStore((state) => state.profile.bind_address)
  const setBindAddress = useConnectionStore((state) => state.setBindAddress)
  const status = useConnectionStore((state) => state.status)
  const locked = status.state !== "Idle" && status.state !== "Error"
  const persistedPort = portFromAddress(bind)
  const [draftPort, setDraftPort] = useState<string | null>(null)
  const displayedPort = draftPort ?? persistedPort

  const commit = () => {
    const normalized = normalizePort(displayedPort)
    const nextAddress = `${LOOPBACK}:${normalized}`
    if (nextAddress !== bind) setBindAddress(nextAddress)
    setDraftPort(null)
  }

  const invalid =
    displayedPort.length > 0 &&
    (Number(displayedPort) < 1 || Number(displayedPort) > 65535)

  return (
    <div className="flex items-center justify-between gap-3">
      <input
        type="text"
        inputMode="numeric"
        value={displayedPort}
        placeholder={DEFAULT_PORT}
        disabled={locked}
        onChange={(event) =>
          setDraftPort(event.target.value.replace(/\D/g, "").slice(0, 5))
        }
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur()
          if (event.key === "Escape") {
            event.preventDefault()
            setDraftPort(null)
          }
        }}
        aria-invalid={invalid}
        className="h-8 w-20 rounded-md bg-black/20 px-2 text-center text-xs text-foreground ring-1 ring-white/10 outline-none focus:ring-primary disabled:opacity-50"
        aria-label="SOCKS5 port"
      />
      <span className="text-xs text-muted-foreground">127.0.0.1 · local only</span>
    </div>
  )
}
