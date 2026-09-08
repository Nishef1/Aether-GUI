export type RuntimePowerMode = "foreground" | "background";

export interface PollPolicy {
  telemetryMs: number | null;
  allowDiagnostics: boolean;
}

/**
 * Keeps Android background work minimal. UI state can continue receiving
 * event-driven updates while expensive polling is disabled.
 */
export function getPollPolicy(
  platform: "android" | "desktop",
  mode: RuntimePowerMode,
  connected: boolean,
): PollPolicy {
  if (!connected) {
    return { telemetryMs: null, allowDiagnostics: false };
  }

  if (platform === "android" && mode === "background") {
    return { telemetryMs: null, allowDiagnostics: false };
  }

  return {
    telemetryMs: platform === "android" ? 3000 : 5000,
    allowDiagnostics: true,
  };
}
