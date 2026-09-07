import { isAndroid } from "@/lib/platform";
import { useWindowFocused } from "@/state/windowFocus";

/**
 * Low-power ambient surface shared by desktop and Android.
 *
 * Android gets only static gradients so the WebView does not spend GPU time on
 * decorative motion. Desktop motion is compositor-only and pauses whenever the
 * app loses focus; reduced-motion is also enforced globally by MotionConfig/CSS.
 */
export function AmbientBackground() {
  const focused = useWindowFocused();
  const playState = { animationPlayState: focused ? ("running" as const) : ("paused" as const) };

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background">
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-18%,rgba(242,113,28,0.18),transparent_38%),radial-gradient(circle_at_105%_78%,rgba(45,212,191,0.08),transparent_34%),radial-gradient(circle_at_-8%_82%,rgba(99,102,241,0.08),transparent_34%),linear-gradient(180deg,#111114_0%,#0d0d0f_48%,#09090b_100%)]"
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.16] [background-image:linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.028)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:linear-gradient(to_bottom,black,transparent_78%)]"
      />

      {!isAndroid && (
        <>
          <div
            aria-hidden
            className="anim-orb-a absolute -top-[24%] -left-[18%] size-[72%] rounded-full bg-primary/12 blur-3xl"
            style={playState}
          />
          <div
            aria-hidden
            className="anim-orb-b absolute -right-[22%] -bottom-[28%] size-[78%] rounded-full bg-cyan-400/[0.065] blur-3xl"
            style={playState}
          />
        </>
      )}

      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_42%,rgba(0,0,0,0.18)_100%)]"
      />
    </div>
  );
}
