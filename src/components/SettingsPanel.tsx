import { useEffect, useRef } from "react"
import { Cpu, ScrollText, ShieldCheck, X } from "lucide-react"
import { CoreManagerPanel } from "@/components/CoreManagerPanel"
import { LiveLogViewer } from "@/components/LiveLogViewer"
import { Switch } from "@/components/ui/switch"
import { isAndroid } from "@/lib/platform"
import { useConnectionStore } from "@/state/connectionStore"

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "select:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(",")

function MobileCoreSummary() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/20 p-3">
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <Cpu className="size-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground">Aether v1.4.0 · ARM64</p>
        <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
          Pinned in this APK · VPN and TUN-to-SOCKS included.
        </p>
      </div>
      <ShieldCheck className="size-4 shrink-0 text-primary" aria-label="Bundled and verified" />
    </div>
  )
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  const loggingEnabled = useConnectionStore((state) => state.loggingEnabled)
  const setLoggingEnabled = useConnectionStore((state) => state.setLoggingEnabled)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    const focusInitialControl = () => closeButtonRef.current?.focus()
    const frame = requestAnimationFrame(focusInitialControl)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== "Tab") return

      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter(
        (element) =>
          !element.hasAttribute("disabled") && element.offsetParent !== null
      )

      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("keydown", handleKeyDown)
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [])

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="absolute inset-0 z-30 flex flex-col bg-background/98 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <div className="flex min-h-12 shrink-0 items-center justify-between border-b border-border px-4 pt-[env(safe-area-inset-top)]">
        <div>
          <h2 id="settings-title" className="text-sm font-semibold text-foreground">
            Settings
          </h2>
          <p className="text-[10px] text-muted-foreground">
            {isAndroid ? "Mobile core and runtime" : "Cores and runtime"}
          </p>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          className="grid size-8 place-items-center rounded-md text-muted-foreground outline-none hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
        <section className={isAndroid ? "space-y-2" : "space-y-3"}>
          <div>
            <h3 className="text-xs font-medium text-foreground">
              {isAndroid ? "Bundled core" : "Core versions"}
            </h3>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              {isAndroid
                ? "This Android build includes a fixed, reproducible native runtime."
                : "Install, switch, or remove inactive Aether, Xray, and sing-box versions while disconnected."}
            </p>
          </div>
          {isAndroid ? <MobileCoreSummary /> : <CoreManagerPanel />}
        </section>

        <div className={isAndroid ? "my-4 h-px bg-border" : "my-5 h-px bg-border"} />

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-muted/20 p-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <ScrollText className="size-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 className="text-xs font-medium text-foreground">Live logs</h3>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {loggingEnabled ? "Recording this session" : "Off"}
                </p>
              </div>
            </div>
            <Switch
              checked={loggingEnabled}
              onCheckedChange={(enabled) => {
                void setLoggingEnabled(enabled).catch(() => undefined)
              }}
              aria-label="Enable live logs"
            />
          </div>

          {loggingEnabled && <LiveLogViewer />}
        </section>
      </div>
    </div>
  )
}
