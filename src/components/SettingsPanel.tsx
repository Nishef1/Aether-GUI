import { useEffect, useRef } from "react"
import { Cpu, ShieldCheck, X } from "lucide-react"
import { CoreManagerPanel } from "@/components/CoreManagerPanel"
import { LiveLogViewer } from "@/components/LiveLogViewer"
import { isAndroid } from "@/lib/platform"

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
    <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Cpu className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground">Aether v1.4.0 · ARM64</p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
            This APK contains one pinned native core. Core updates arrive with a new
            APK so a partially downloaded binary can never replace the working core.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-border/60 pt-2 text-[10px] text-muted-foreground">
        <ShieldCheck className="size-3.5 text-primary" aria-hidden="true" />
        Proxy-only alpha; system TUN remains disabled until validated.
      </div>
    </div>
  )
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)

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
            {isAndroid
              ? "Mobile core, diagnostics, and runtime details"
              : "Cores, diagnostics, and runtime details"}
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
        <section className="space-y-3">
          <div>
            <h3 className="text-xs font-medium text-foreground">
              {isAndroid ? "Bundled core" : "Core versions"}
            </h3>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              {isAndroid
                ? "The Android package uses one reproducible ARM64 core built with the app."
                : "Install, switch, or remove inactive Aether, Xray, and sing-box versions while disconnected."}
            </p>
          </div>
          {isAndroid ? <MobileCoreSummary /> : <CoreManagerPanel />}
        </section>

        <div className="my-5 h-px bg-border" />

        <section className="space-y-3">
          <div>
            <h3 className="text-xs font-medium text-foreground">Live logs</h3>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Recent bounded runtime output. Structured diagnostics restart on every
              app launch and stop writing after the session size cap is reached.
            </p>
          </div>
          <LiveLogViewer />
        </section>
      </div>
    </div>
  )
}
