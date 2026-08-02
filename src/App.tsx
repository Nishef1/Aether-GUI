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
  return (
    <div className="relative z-10 flex h-full flex-col items-center overflow-y-auto p-6">
      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        <ConnectButton />
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

  useEffect(() => {
    const connectionCleanup = initConnectionListeners();
    const telemetryCleanup = initTelemetryListeners();
    return () => {
      void connectionCleanup.then((unlisten) => unlisten());
      void telemetryCleanup.then((unlisten) => unlisten());
    };
  }, []);

  return (
    <TooltipProvider>
      <MotionConfig reducedMotion={isAndroid ? "always" : "user"}>
        <div
          className={`relative flex h-svh w-full flex-col overflow-hidden bg-background${isAndroid ? " platform-android" : ""}`}
        >
          <AmbientBackground />
          <TitleBar />
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
