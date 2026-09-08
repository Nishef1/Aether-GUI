export type TelemetryScheduleContext = {
  visible: boolean;
  connected: boolean;
  probeComplete: boolean;
};

export const TELEMETRY_INITIAL_INTERVAL_MS = 2_000;
export const TELEMETRY_STABLE_INTERVAL_MS = 5_000;

export function shouldScheduleTelemetry(context: TelemetryScheduleContext): boolean {
  return context.visible && context.connected;
}

export function nextTelemetryDelay(context: TelemetryScheduleContext): number | null {
  if (!shouldScheduleTelemetry(context)) return null;
  return context.probeComplete ? TELEMETRY_STABLE_INTERVAL_MS : TELEMETRY_INITIAL_INTERVAL_MS;
}
