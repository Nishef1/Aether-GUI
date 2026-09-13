import { useAutomaticRuntimeStore } from "@/state/automaticRuntimeStore";
import { useConnectionStore } from "@/state/connectionStore";

function clearIdleTransientState(): void {
  const state = useConnectionStore.getState();
  if (state.status.state !== "Idle") return;

  useAutomaticRuntimeStore.getState().clearAttempt();
  if (
    !state.accessCodeRequired &&
    state.scanBudgetSecs === null &&
    state.runtimePath === null &&
    state.runtimePathAttemptId === null &&
    state.runtimeCapacity === null &&
    state.runtimeCapacityAttemptId === null
  ) {
    return;
  }

  useConnectionStore.setState({
    accessCodeRequired: false,
    scanBudgetSecs: null,
    runtimePath: null,
    runtimePathAttemptId: null,
    runtimeCapacity: null,
    runtimeCapacityAttemptId: null,
  });
}

/**
 * Native Android notification actions, OS-driven teardown and desktop shutdown
 * can all reach Idle without going through the React disconnect button. Keep
 * the presentation baseline deterministic for those paths too.
 */
export function initConnectionUiLifecycle(): () => void {
  clearIdleTransientState();
  return useConnectionStore.subscribe((state, previous) => {
    if (state.status.state === "Idle" && previous.status.state !== "Idle") {
      clearIdleTransientState();
    }
  });
}
