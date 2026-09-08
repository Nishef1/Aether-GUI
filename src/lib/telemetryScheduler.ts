export type TelemetryScheduleContext = {
  visible: boolean;
  connected: boolean;
  probeComplete: boolean;
};

// Native telemetry events are the primary update path. Polling exists only as
// foreground reconciliation for Android lifecycle/event-loss edge cases, so it
// should stay responsive during startup without waking a stable session every
// couple of seconds.
export const TELEMETRY_INITIAL_INTERVAL_MS = 3_000;
export const TELEMETRY_STABLE_INTERVAL_MS = 10_000;

export function shouldScheduleTelemetry(context: TelemetryScheduleContext): boolean {
  return context.visible && context.connected;
}

export function nextTelemetryDelay(context: TelemetryScheduleContext): number | null {
  if (!shouldScheduleTelemetry(context)) return null;
  return context.probeComplete ? TELEMETRY_STABLE_INTERVAL_MS : TELEMETRY_INITIAL_INTERVAL_MS;
}
