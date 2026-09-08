export type TelemetryLifecycleState = {
  visible: boolean;
  connected: boolean;
};

export function canCollectTelemetry(state: TelemetryLifecycleState): boolean {
  return state.visible && state.connected;
}

export function shouldClearTelemetryOnDisconnect(connected: boolean): boolean {
  return !connected;
}
