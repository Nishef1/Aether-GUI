import { invoke } from "@tauri-apps/api/core";
import { useAutomaticRuntimeStore } from "@/state/automaticRuntimeStore";
import { useConnectionStore } from "@/state/connectionStore";
import type { ConnectionStatus } from "@/types/connection";

const DISCONNECT_TIMEOUT_MS = 12_000;
const DISCONNECT_RETRY_AFTER_MS = 1_500;
const DISCONNECT_POLL_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function attemptIsCurrent(attemptId: number): boolean {
  return useConnectionStore.getState().attemptId === attemptId;
}

function resetUiToIdle(attemptId: number): boolean {
  if (!attemptIsCurrent(attemptId)) return false;

  useAutomaticRuntimeStore.getState().clearAttempt();
  useConnectionStore.setState({
    status: { state: "Idle" },
    accessCodeRequired: false,
    scanBudgetSecs: null,
    runtimePath: null,
    runtimePathAttemptId: null,
    runtimeCapacity: null,
    runtimeCapacityAttemptId: null,
  });
  return true;
}

async function requestNativeStop(): Promise<string | null> {
  try {
    await invoke("disconnect");
    return null;
  } catch (error) {
    return String(error);
  }
}

async function readNativeStatus(): Promise<ConnectionStatus> {
  return invoke<ConnectionStatus>("get_status");
}

/**
 * User-facing disconnect is intentionally stronger than the recovery stop used
 * by Automatic fallback. The first store action invalidates the current
 * attempt and clears per-attempt metadata; this function then waits for the
 * native runtime to actually reach Idle instead of assuming that an accepted
 * stop IPC means cleanup has finished.
 *
 * During that bounded cleanup window, stale Error/Connected snapshots from the
 * session being torn down are kept out of the UI. We only publish Idle after
 * the native runtime confirms it. If cleanup cannot be confirmed, we surface a
 * dedicated disconnect error rather than pretending the VPN is stopped.
 */
export async function disconnectAndReset(): Promise<boolean> {
  const before = useConnectionStore.getState();
  if (before.status.state === "Idle") {
    return resetUiToIdle(before.attemptId);
  }

  const startedAt = Date.now();
  const disconnectPromise = before.disconnect();
  // disconnect() increments attemptId synchronously before its first await.
  // Capturing it here lets us suppress stale snapshots even while the initial
  // native stop IPC is still in flight.
  const attemptId = useConnectionStore.getState().attemptId;
  let retriedStop = false;
  let lastFailure: string | null = null;
  let publishingTerminalFailure = false;

  const keepResetVisualStable = useConnectionStore.subscribe((state) => {
    if (publishingTerminalFailure || state.attemptId !== attemptId) return;
    if (state.status.state === "Idle" || state.status.state === "Disconnecting") return;
    useConnectionStore.setState({ status: { state: "Disconnecting" } });
  });

  try {
    try {
      await disconnectPromise;
    } catch (error) {
      // The store currently absorbs native stop failures, but keep this guard so
      // a future implementation cannot strand the UI by rejecting here.
      lastFailure = String(error);
    }

    while (attemptIsCurrent(attemptId) && Date.now() - startedAt < DISCONNECT_TIMEOUT_MS) {
      try {
        const status = await readNativeStatus();
        if (!attemptIsCurrent(attemptId)) return false;

        if (status.state === "Idle") return resetUiToIdle(attemptId);
        if (status.state === "Error") lastFailure = status.message;

        useConnectionStore.setState({ status: { state: "Disconnecting" } });

        const elapsed = Date.now() - startedAt;
        if (!retriedStop && (status.state === "Error" || elapsed >= DISCONNECT_RETRY_AFTER_MS)) {
          retriedStop = true;
          lastFailure = (await requestNativeStop()) ?? lastFailure;
        }
      } catch (error) {
        lastFailure = String(error);
        if (!attemptIsCurrent(attemptId)) return false;
        if (!retriedStop && Date.now() - startedAt >= DISCONNECT_RETRY_AFTER_MS) {
          retriedStop = true;
          lastFailure = (await requestNativeStop()) ?? lastFailure;
        }
      }

      await sleep(DISCONNECT_POLL_MS);
    }

    if (!attemptIsCurrent(attemptId)) return false;

    // One last idempotent stop/reconcile pass handles an Android service that
    // crossed a lifecycle boundary right at the timeout edge.
    lastFailure = (await requestNativeStop()) ?? lastFailure;
    try {
      const finalStatus = await readNativeStatus();
      if (!attemptIsCurrent(attemptId)) return false;
      if (finalStatus.state === "Idle") return resetUiToIdle(attemptId);
      if (finalStatus.state === "Error") lastFailure = finalStatus.message;
    } catch (error) {
      lastFailure = String(error);
    }

    if (!attemptIsCurrent(attemptId)) return false;
    publishingTerminalFailure = true;
    useAutomaticRuntimeStore.getState().clearAttempt();
    useConnectionStore.setState({
      status: {
        state: "Error",
        message: lastFailure
          ? `Could not confirm a clean disconnect: ${lastFailure}`
          : "Could not confirm that the native VPN stopped cleanly.",
        phase: "disconnect",
      },
      accessCodeRequired: false,
      scanBudgetSecs: null,
      runtimePath: null,
      runtimePathAttemptId: null,
      runtimeCapacity: null,
      runtimeCapacityAttemptId: null,
    });
    return false;
  } finally {
    keepResetVisualStable();
  }
}
