import { isAndroid } from "@/lib/platform";
import { useWindowFocused } from "@/state/windowFocus";

/**
 * Compositor-only ambient background. Android intentionally omits it: the
 * foreground VPN service is the product, so the WebView should stop consuming
 * GPU cycles as soon as it is not needed.
 */
export function AmbientBackground() {
  const focused = useWindowFocused();
  if (isAndroid) return null;

  const playState = { animationPlayState: focused ? ("running" as const) : ("paused" as const) };

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background">
      <div
        className="anim-orb-1 absolute -top-[20%] -left-[15%] size-[70%] rounded-full bg-primary/10 blur-3xl"
        style={playState}
      />
      <div
        className="anim-orb-2 absolute -right-[20%] -bottom-[25%] size-[75%] rounded-full bg-blue-500/8 blur-3xl"
        style={playState}
      />
      <div
        className="anim-orb-3 absolute top-[35%] left-[35%] size-[35%] rounded-full bg-violet-500/5 blur-3xl"
        style={playState}
      />
    </div>
  );
}
