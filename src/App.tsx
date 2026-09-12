import { lazy, Suspense, useEffect } from "react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { LoaderCircle, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConnectButton } from "@/components/ConnectButton";
import { ConnectionDiagnostics } from "@/components/ConnectionDiagnostics";
import { ConnectionStatusLine } from "@/components/ConnectionStatusLine";
import { QuickConnectionCard } from "@/components/QuickConnectionCard";
import { CloseToTrayToggle } from "@/components/CloseToTrayToggle";
import { AmbientBackground } from "@/components/AmbientBackground";
import { SidecarErrorScreen } from "@/components/SidecarErrorScreen";
import { AccessCodePrompt } from "@/components/AccessCodePrompt";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TitleBar } from "@/components/TitleBar";
import { connectWithAutomaticPolicy } from "@/lib/autoConnect";
import { cn } from "@/lib/utils";
import { isAndroid } from "@/lib/platform";
import { initConnectionListeners, useConnectionStore } from "@/state/connectionStore";
import { useExitPolicyStore } from "@/state/exitPolicyStore";
import { initPathIntelligence } from "@/state/pathStore";
import { useSystemTunnelStore } from "@/state/systemTunnelStore";
import { initTelemetryListeners } from "@/state/telemetryStore";

const AdvancedPanel = lazy(() =>
  import("@/components/AdvancedPanel").then((module) => ({ default: module.AdvancedPanel })),
);

const SCREEN_TRANSITION = isAndroid
  ? {
      initial: false as const,
      animate: { opacity: 1 },
      exit: { opacity: 1 },
      transition: { duration: 0 },
    }
  : {
      initial: { opacity: 0, y: 8 },
      animate: { opacity: 1, y: 0 },
      exit: { opacity: 0, y: -4 },
      transition: { duration: 0.16, ease: [0.22, 1, 0.36, 1] as const },
    };

function MobileHeader() {
  const loaded = useSystemTunnelStore((state) => state.loaded);
  const selection = useSystemTunnelStore((state) => state.selection);
  const error = useSystemTunnelStore((state) => state.error);
  const ready = loaded && selection === "native" && !error;
  const Icon = error ? TriangleAlert : ready ? ShieldCheck : LoaderCircle;
  const label = error ? "VPN attention" : ready ? "Device VPN ready" : "Preparing VPN";

  return (
    <header className="mb-2 flex w-full items-center justify-between gap-3 px-0.5">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold tracking-[0.18em] text-primary uppercase">
          Aether
        </p>
        <h1 className="mt-0.5 truncate text-lg font-semibold tracking-tight text-foreground">
          Private connection
        </h1>
      </div>
      <span
        className={cn(
          "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium ring-1",
          error
            ? "bg-status-error/8 text-status-error ring-status-error/20"
            : ready
              ? "bg-status-connected/8 text-status-connected ring-status-connected/20"
              : "bg-status-connecting/8 text-status-connecting ring-status-connecting/20",
        )}
        role="status"
      >
        <Icon size={13} className={!error && !ready ? "android-connect-spin" : undefined} />
        {label}
      </span>
    </header>
  );
}

function MainScreen() {
  const attemptId = useConnectionStore((state) => state.attemptId);
  const tunnelLoaded = useSystemTunnelStore((state) => state.loaded);
  const tunnelSelection = useSystemTunnelStore((state) => state.selection);
  const tunnelError = useSystemTunnelStore((state) => state.error);
  const reloadTunnel = useSystemTunnelStore((state) => state.load);
  const mobileTunnelReady =
    !isAndroid || (tunnelLoaded && tunnelSelection === "native" && !tunnelError);

  return (
    <div className="app-scroll relative z-10 h-full overflow-y-auto overscroll-contain">
      <div className="mx-auto flex w-full max-w-[34rem] flex-col gap-3 px-4 sm:px-5">
        {isAndroid && <MobileHeader />}

        <section className="connection-hero relative overflow-hidden rounded-[2rem] bg-surface-1/72 px-4 py-5 ring-1 ring-white/10 backdrop-blur-sm sm:px-6 sm:py-6">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent"
          />
          <div className="flex flex-col items-center gap-4 text-center">
            {!mobileTunnelReady ? (
              <div className="grid min-h-36 w-full place-items-center rounded-3xl bg-black/15 px-5 py-5 ring-1 ring-white/8">
                <div className="max-w-72">
                  <div
                    className={cn(
                      "mx-auto mb-3 grid size-11 place-items-center rounded-2xl ring-1",
                      tunnelError
                        ? "bg-status-error/8 text-status-error ring-status-error/15"
                        : "bg-white/5 text-muted-foreground ring-white/10",
                    )}
                  >
                    {tunnelError ? <TriangleAlert size={20} /> : <ShieldCheck size={20} />}
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    {tunnelError ? "Device VPN needs attention" : "Preparing device VPN"}
                  </p>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                    {tunnelError
                      ? "Aether will not connect until the Android device tunnel is ready."
                      : "Aether is loading the native tunnel before Connect becomes available."}
                  </p>
                  {tunnelError && (
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-3 min-h-12 px-4"
                      onClick={() => void reloadTunnel()}
                    >
                      Retry device VPN
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <ConnectButton />
            )}
            <ConnectionStatusLine />
            <AccessCodePrompt key={attemptId} />
          </div>
        </section>

        <ConnectionDiagnostics />
        <QuickConnectionCard />

        <Suspense
          fallback={
            <div className="min-h-14 w-full rounded-2xl bg-white/[0.025] ring-1 ring-white/8" />
          }
        >
          <AdvancedPanel />
        </Suspense>

        {!isAndroid && (
          <div className="px-1 pb-1">
            <CloseToTrayToggle />
          </div>
        )}
      </div>
    </div>
  );
}

export function App() {
  const sidecarError = useConnectionStore((state) => state.sidecarError);
  const retryAfterSidecarError = useConnectionStore((state) => state.retryAfterSidecarError);
  const beginManualAttempt = useExitPolicyStore((state) => state.beginManualAttempt);
  const loadSystemTunnel = useSystemTunnelStore((state) => state.load);

  useEffect(() => {
    const safeCleanup = (promise: Promise<() => void>, label: string) =>
      promise.catch((error) => {
        console.error(`${label} initialization failed:`, error);
        return () => undefined;
      });

    const connectionCleanup = safeCleanup(initConnectionListeners(), "Connection listeners");
    const telemetryCleanup = safeCleanup(initTelemetryListeners(), "Telemetry listeners");
    const pathCleanup = initPathIntelligence();

    return () => {
      pathCleanup();
      void connectionCleanup.then((unlisten) => unlisten());
      void telemetryCleanup.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    // Load on every platform before the user can connect. Android enforces the
    // native VpnService path; desktop applies the one-time full-device default.
    void loadSystemTunnel();
  }, [loadSystemTunnel]);

  return (
    <TooltipProvider delayDuration={350} skipDelayDuration={100}>
      <MotionConfig reducedMotion={isAndroid ? "always" : "user"}>
        <div
          className={`relative flex h-svh w-full flex-col overflow-hidden bg-background${isAndroid ? " platform-android" : " platform-desktop"}`}
        >
          <AmbientBackground />
          {!isAndroid && <TitleBar />}
          <div className="relative min-h-0 flex-1">
            <AnimatePresence mode="sync">
              {sidecarError ? (
                <motion.div key="error" className="absolute inset-0 z-10" {...SCREEN_TRANSITION}>
                  <SidecarErrorScreen
                    message={sidecarError}
                    onRetry={() => {
                      retryAfterSidecarError();
                      beginManualAttempt();
                      void connectWithAutomaticPolicy();
                    }}
                  />
                </motion.div>
              ) : (
                <motion.div key="main" className="absolute inset-0" {...SCREEN_TRANSITION}>
                  <MainScreen />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </MotionConfig>
    </TooltipProvider>
  );
}

export default App;
