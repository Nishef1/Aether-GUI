import { lazy, Suspense, useEffect } from "react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { ConnectButton } from "@/components/ConnectButton";
import { ConnectionStatusLine } from "@/components/ConnectionStatusLine";
import { CloseToTrayToggle } from "@/components/CloseToTrayToggle";
import { AmbientBackground } from "@/components/AmbientBackground";
import { SidecarErrorScreen } from "@/components/SidecarErrorScreen";
import { AccessCodePrompt } from "@/components/AccessCodePrompt";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TitleBar } from "@/components/TitleBar";
import { isAndroid } from "@/lib/platform";
import { initConnectionListeners, useConnectionStore } from "@/state/connectionStore";
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

function MainScreen() {
  const attemptId = useConnectionStore((state) => state.attemptId);
  const tunnelReady = useSystemTunnelStore(
    (state) => state.loaded && state.selection === "native",
  );
  const tunnelError = useSystemTunnelStore((state) => state.error);
  const mobileSafeArea = isAndroid
    ? {
        paddingTop: "max(1rem, env(safe-area-inset-top, 0px))",
        paddingBottom: "calc(max(1.5rem, env(safe-area-inset-bottom, 0px)) + 1.5rem)",
        scrollPaddingBottom: "calc(max(1.5rem, env(safe-area-inset-bottom, 0px)) + 1.5rem)",
      }
    : undefined;

  return (
    <div
      className={`relative z-10 flex h-full flex-col items-center overflow-y-auto ${isAndroid ? "px-5" : "p-6"}`}
      style={mobileSafeArea}
    >
      <div
        className={
          isAndroid
            ? "flex min-h-72 w-full shrink-0 flex-col items-center justify-center gap-4 py-4"
            : "flex flex-1 flex-col items-center justify-center gap-6"
        }
      >
        {isAndroid && !tunnelReady ? (
          <div className="grid size-40 place-items-center rounded-full bg-surface-2 text-center ring-1 ring-white/10">
            <span className="max-w-24 text-xs leading-5 text-muted-foreground">
              {tunnelError ? "VPN tunnel unavailable" : "Preparing VPN tunnel"}
            </span>
          </div>
        ) : (
          <ConnectButton />
        )}
        <ConnectionStatusLine />
        <AccessCodePrompt key={attemptId} />
      </div>
      <Suspense fallback={<div className="h-9 w-full max-w-sm" aria-hidden="true" />}>
        <AdvancedPanel />
      </Suspense>
      {!isAndroid && <CloseToTrayToggle />}
    </div>
  );
}

export function App() {
  const sidecarError = useConnectionStore((state) => state.sidecarError);
  const retryAfterSidecarError = useConnectionStore((state) => state.retryAfterSidecarError);
  const connect = useConnectionStore((state) => state.connect);
  const loadSystemTunnel = useSystemTunnelStore((state) => state.load);

  useEffect(() => {
    const connectionCleanup = initConnectionListeners();
    const telemetryCleanup = initTelemetryListeners();
    return () => {
      void connectionCleanup.then((unlisten) => unlisten());
      void telemetryCleanup.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (isAndroid) void loadSystemTunnel();
  }, [loadSystemTunnel]);

  return (
    <TooltipProvider>
      <MotionConfig reducedMotion={isAndroid ? "always" : "user"}>
        <div
          className={`relative flex h-svh w-full flex-col overflow-hidden bg-background${isAndroid ? " platform-android" : ""}`}
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
                      void connect();
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
