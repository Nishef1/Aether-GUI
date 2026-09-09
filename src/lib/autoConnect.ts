import { invoke } from "@tauri-apps/api/core";
import { automaticAttemptBudgetMs, buildAutomaticCandidates } from "@/lib/automaticPolicy";
import { profileForNativeInvoke } from "@/lib/nativeProfile";
import { useConnectionStore } from "@/state/connectionStore";
import { refreshPathNetworkContext, usePathStore } from "@/state/pathStore";
import type { ConnectionProfile, ConnectionStatus } from "@/types/connection";

const RECONCILE_MS = 750;
const STOP_TIMEOUT_MS = 8_000;

let automationEpoch = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stable(status: ConnectionStatus): boolean {
  return status.state === "Connected" || status.state === "Tunneling";
}

function binaryUnavailable(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("binary not found") ||
    normalized.includes("bundled arm64 aether core was not found")
  );
}

async function reconcileStatus(): Promise<ConnectionStatus> {
  try {
    const status = await invoke<ConnectionStatus>("get_status");
    useConnectionStore.setState({ status });
    return status;
  } catch {
    return useConnectionStore.getState().status;
  }
}

async function waitForOutcome(
  epoch: number,
  budgetMs: number,
): Promise<"connected" | "failed" | "cancelled" | "timeout"> {
  let deadline = Date.now() + budgetMs;
  while (epoch === automationEpoch) {
    const status = await reconcileStatus();
    if (stable(status)) return "connected";
    if (status.state === "Error") return "failed";

    // Interactive Zero Trust input is user-paced and must not burn through the
    // transport scan budget while the runtime is waiting for a one-time code.
    if (status.state === "AwaitingAccessCode") {
      deadline += RECONCILE_MS;
    } else if (Date.now() >= deadline) {
      return "timeout";
    }
    await sleep(RECONCILE_MS);
  }
  return "cancelled";
}

async function stopBetweenCandidates(epoch: number): Promise<boolean> {
  await invoke("disconnect").catch(() => undefined);
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (epoch === automationEpoch && Date.now() < deadline) {
    const status = await reconcileStatus();
    if (status.state === "Idle" || status.state === "Error") return true;
    await sleep(200);
  }
  return epoch === automationEpoch;
}

function prepareAttempt(budgetMs: number): void {
  const connection = useConnectionStore.getState();
  connection.clearLogs();
  useConnectionStore.setState((state) => ({
    status: { state: "Launching" },
    accessCodeRequired: false,
    runtimePath: null,
    runtimePathAttemptId: null,
    runtimeCapacity: null,
    runtimeCapacityAttemptId: null,
    scanBudgetSecs: Math.max(1, Math.round(budgetMs / 1000) - 30),
    sidecarError: null,
    attemptId: state.attemptId + 1,
  }));
}

async function invokeCandidate(profile: ConnectionProfile): Promise<string | null> {
  try {
    await invoke("connect", { profileOverride: profileForNativeInvoke(profile) });
    return null;
  } catch (error) {
    return String(error);
  }
}

export function cancelAutomaticConnect(): void {
  automationEpoch += 1;
}

export async function connectWithAutomaticPolicy(): Promise<void> {
  const connection = useConnectionStore.getState();
  const base = connection.profile;
  if (base.protocol !== "auto") {
    cancelAutomaticConnect();
    await connection.connect();
    return;
  }

  // Historical ordering is only safe after the current underlay fingerprint is
  // resolved. An unknown context intentionally produces an empty history and
  // falls back to the baseline transport order instead of replaying another
  // network's winner.
  await refreshPathNetworkContext();
  const candidates = buildAutomaticCandidates(base, usePathStore.getState().paths);
  if (candidates.length === 0) {
    await connection.connect();
    return;
  }

  const epoch = ++automationEpoch;
  let lastError = "No automatic transport completed validation";

  for (let index = 0; index < candidates.length; index += 1) {
    if (epoch !== automationEpoch) return;
    const candidate = candidates[index];
    const budgetMs = automaticAttemptBudgetMs(candidate.profile);
    prepareAttempt(budgetMs);

    const launchError = await invokeCandidate(candidate.profile);
    if (launchError != null) {
      lastError = launchError;
      if (binaryUnavailable(launchError)) {
        useConnectionStore.setState({
          sidecarError: launchError,
          status: { state: "Error", message: launchError, phase: "launching" },
        });
        return;
      }
    } else {
      const outcome = await waitForOutcome(epoch, budgetMs);
      if (outcome === "connected") {
        if (epoch === automationEpoch) automationEpoch += 1;
        return;
      }
      if (outcome === "cancelled") return;
      const status = useConnectionStore.getState().status;
      lastError =
        status.state === "Error"
          ? status.message
          : `${candidate.label} did not finish within its bounded scan window`;
    }

    if (index + 1 < candidates.length) {
      if (!(await stopBetweenCandidates(epoch))) return;
    }
  }

  if (epoch !== automationEpoch) return;
  automationEpoch += 1;
  useConnectionStore.setState({
    status: {
      state: "Error",
      message: `Automatic transport fallback exhausted: ${lastError}`,
      phase: "automatic-v2",
    },
    accessCodeRequired: false,
  });
}
