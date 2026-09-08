export type TelemetryScheduleContext = {
  visible: boolean;
  connected: boolean;
};

export const TELEMETRY_FOREGROUND_INTERVAL_MS = 2_000;

export function shouldScheduleTelemetry(context: TelemetryScheduleContext): boolean {
  return context.visible && context.connected;
}

export function nextTelemetryDelay(context: TelemetryScheduleContext): number | null {
  return shouldScheduleTelemetry(context) ? TELEMETRY_FOREGROUND_INTERVAL_MS : null;
}
