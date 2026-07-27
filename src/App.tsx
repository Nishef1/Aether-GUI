import { useEffect, useState } from "react"
import { AnimatePresence, motion, MotionConfig } from "motion/react"
import { Settings } from "lucide-react"
import { ConnectButton } from "@/components/ConnectButton"
import { ConnectionStatusLine } from "@/components/ConnectionStatusLine"
import { ConnectionModeToggle } from "@/components/ConnectionModeToggle"
import { AdvancedPanel } from "@/components/AdvancedPanel"
import { CloseToTrayToggle } from "@/components/CloseToTrayToggle"
import { AmbientBackground } from "@/components/AmbientBackground"
import { SidecarErrorScreen } from "@/components/SidecarErrorScreen"
import { SettingsPanel } from "@/components/SettingsPanel"
import { TooltipProvider } from "@/components/ui/tooltip"
import { TitleBar } from "@/components/TitleBar"
import { isAndroid } from "@/lib/platform"
import {
  initConnectionListeners,
  useConnectionStore,
} from "@/state/connectionStore"
import { useCoreStore } from "@/state/coreStore"

const SCREEN_TRANSITION = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.16, ease: [0.22, 1, 0.36, 1] as const },
}

function MobileHeader({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <header className="relative z-20 flex min-h-14 items-center justify-between px-5 pt-[max(env(safe-area-inset-top),0.5rem)]">
      <div>
        <p className="text-sm font-semibold tracking-tight">Aether</p>
        <p className="text-[10px] text-muted-foreground">Android ARM64</p>
      </div>
      <button
        type="button"
        onClick={onOpenSettings}
        className="grid size-9 place-items-center rounded-lg border border-border/70 bg-background/70 text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Open settings"
      >
        <Settings className="size-4" aria-hidden="true" />
      </button>
    </header>
  )
}

function MainScreen() {
  return (
    <div
      className={`relative z-10 flex h-full flex-col items-center overflow-y-auto pb-[max(env(safe-area-inset-bottom),1.5rem)] ${
        isAndroid ? "gap-4 px-4 pt-3" : "p-6"
      }`}
    >
      <ConnectionModeToggle />
      <div
        className={`flex flex-col items-center justify-center gap-5 ${
          isAndroid ? "min-h-[278px] shrink-0 py-4" : "min-h-52 flex-1 gap-6 py-5"
        }`}
      >
        <ConnectButton />
        <ConnectionStatusLine />
      </div>
      <AdvancedPanel />
      {!isAndroid && <CloseToTrayToggle />}
    </div>
  )
}

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const sidecarError = useConnectionStore((s) => s.sidecarError)
  const retryAfterSidecarError = useConnectionStore(
    (s) => s.retryAfterSidecarError
  )
  const connect = useConnectionStore((s) => s.connect)
  const loadCores = useCoreStore((s) => s.loadAll)

  useEffect(() => {
    const cleanup = initConnectionListeners()
    return () => {
      void cleanup.then((unlisten) => unlisten())
    }
  }, [])

  useEffect(() => {
    // Android bundles one pinned ARM64 Aether core. Desktop still inspects its
    // local core registry so version management remains unchanged there.
    if (!isAndroid) void loadCores()
  }, [loadCores])

  useEffect(() => {
    if (!isAndroid) return

    // Android's system Back action asks the WebView to navigate its history.
    // Settings is an in-app screen rather than a route, so give it one history
    // entry and translate Back into closing the panel instead of leaving Aether.
    const closeSettingsFromHistory = () => setSettingsOpen(false)
    window.addEventListener("popstate", closeSettingsFromHistory)
    return () => window.removeEventListener("popstate", closeSettingsFromHistory)
  }, [])

  const openSettings = () => {
    if (isAndroid) window.history.pushState({ aetherScreen: "settings" }, "")
    setSettingsOpen(true)
  }

  const closeSettings = () => {
    if (isAndroid && window.history.state?.aetherScreen === "settings") {
      window.history.back()
      return
    }
    setSettingsOpen(false)
  }

  return (
    <TooltipProvider>
      <MotionConfig reducedMotion="user">
        <div className="relative flex h-svh w-full flex-col overflow-hidden bg-background">
          <AmbientBackground />
          {isAndroid ? (
            <MobileHeader onOpenSettings={openSettings} />
          ) : (
            <TitleBar onOpenSettings={openSettings} />
          )}
          <div className="relative min-h-0 flex-1">
            <AnimatePresence mode="sync">
              {sidecarError ? (
                <motion.div
                  key="error"
                  className="absolute inset-0 z-10"
                  {...SCREEN_TRANSITION}
                >
                  <SidecarErrorScreen
                    message={sidecarError}
                    onRetry={() => {
                      retryAfterSidecarError()
                      void connect()
                    }}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="main"
                  className="absolute inset-0"
                  {...SCREEN_TRANSITION}
                >
                  <MainScreen />
                </motion.div>
              )}
            </AnimatePresence>

            {settingsOpen && (
              <SettingsPanel onClose={closeSettings} />
            )}
          </div>
        </div>
      </MotionConfig>
    </TooltipProvider>
  )
}

export default App
