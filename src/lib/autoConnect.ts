import { invoke } from "@tauri-apps/api/core";
import { automaticAttemptBudgetMs, buildAutomaticCandidates } from "@/lib/automaticPolicy";
import { profileForNativeInvoke } from "@/lib/nativeProfile";
import { useAutomaticRuntimeStore } from "@/state/automaticRuntimeStore";
import { useConnectionStore } from "@/state/connectionStore";
import { refreshPathNetworkContext, usePathStore } from "@/state/pathStore";
import type { ConnectionProfile, ConnectionStatus } from "@/types/connection";

const RECONCILE_MS = 750;
const STOP_TIMEOUT_MS = 8_000;

let automationEpoch = 0;

type StopOutcome = "stopped" | "cancelled" | "timeout";

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

function singleProfileLabel(profile: ConnectionProfile): string {
  switch (profile.protocol) {
    case "masque":
      return profile.masque_http2 ? "MASQUE H2" : "MASQUE H3";
    case "wireguard":
      return "WireGuard";
    case "gool":
      return "Warp-in-Warp";
    case "auto":
      return "Automatic";
  }
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

async function stopBetweenCandidates(epoch: number): Promise<StopOutcome> {
  await invoke("disconnect").catch(() => undefined);
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (epoch !== automationEpoch) return "cancelled";
    const status = await reconcileStatus();
    if (status.state === "Idle" || status.state === "Error") return "stopped";
    await sleep(200);
  }
  return epoch === automationEpoch ? "timeout" : "cancelled";
}

function prepareAttempt(
  profile: ConnectionProfile,
  budgetMs: number,
  label: string,
  index: number,
  total: number,
): number {
  const connection = useConnectionStore.getState();
  connection.clearLogs();

  let attemptId = connection.attemptId + 1;
  useConnectionStore.setState((state) => {
    attemptId = state.attemptId + 1;
    return {
      status: { state: "Launching" },
      accessCodeRequired: false,
      runtimePath: null,
      runtimePathAttemptId: null,
      runtimeCapacity: null,
      runtimeCapacityAttemptId: null,
      scanBudgetSecs: Math.max(1, Math.round(budgetMs / 1000) - 30),
      sidecarError: null,
      attemptId,
    };
  });
  useAutomaticRuntimeStore.getState().beginAttempt({
    attemptId,
    profile,
    label,
    index,
    total,
  });
  return attemptId;
}

async function invokeCandidate(profile: ConnectionProfile): Promise<string | null> {
  try {
    await invoke("connect", { profileOverride: profileForNativeInvoke(profile) });
    return null;
  } catch (error) {
    return String(error);
  }
}

function publishLaunchError(message: string, phase: string): void {
  if (binaryUnavailable(message)) {
    useConnectionStore.setState({
      sidecarError: message,
      status: { state: "Error", message, phase: "launching" },
      accessCodeRequired: false,
    });
    return;
  }
  useConnectionStore.setState({
    status: { state: "Error", message, phase },
    accessCodeRequired: false,
  });
}

export function cancelAutomaticConnect(): void {
  automationEpoch += 1;
  useAutomaticRuntimeStore.getState().clearAttempt();
}

export async function connectWithAutomaticPolicy(
  profileOverride?: ConnectionProfile,
): Promise<void> {
  const connection = useConnectionStore.getState();
  const base = profileOverride ?? connection.profile;

  if (base.protocol !== "auto") {
    cancelAutomaticConnect();
    if (profileOverride == null) {
      await connection.connect();
      return;
    }

    const budgetMs = automaticAttemptBudgetMs(base);
    prepareAttempt(base, budgetMs, singleProfileLabel(base), 1, 1);
    const launchError = await invokeCandidate(base);
    if (launchError != null) publishLaunchError(launchError, "launching");
    return;
  }

  // Reserve the orchestration epoch before any asynchronous bootstrap work.
  // This closes the double-click/cancel window while network fingerprinting is
  // still resolving and prevents a stale caller from launching a candidate.
  const epoch = ++automationEpoch;
  useConnectionStore.setState({
    status: { state: "Launching" },
    accessCodeRequired: false,
    sidecarError: null,
  });

  // Historical ordering is only safe after the current underlay fingerprint is
  // resolved. An unknown context intentionally produces an empty history and
  // falls back to the baseline transport order instead of replaying another
  // network's winner.
  await refreshPathNetworkContext();
  if (epoch !== automationEpoch) return;

  const candidates = buildAutomaticCandidates(base, usePathStore.getState().paths);
  if (candidates.length === 0) {
    if (epoch === automationEpoch) automationEpoch += 1;
    await connection.connect();
    return;
  }

  let lastError = "No automatic transport completed validation";

  for (let index = 0; index < candidates.length; index += 1) {
    if (epoch !== automationEpoch) return;
    const candidate = candidates[index];
    const budgetMs = automaticAttemptBudgetMs(candidate.profile);
    prepareAttempt(candidate.profile, budgetMs, candidate.label, index + 1, candidates.length);

    const launchError = await invokeCandidate(candidate.profile);
    if (launchError != null) {
      lastError = launchError;
      if (binaryUnavailable(launchError)) {
        publishLaunchError(launchError, "launching");
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
      const stopOutcome = await stopBetweenCandidates(epoch);
      if (stopOutcome === "cancelled") return;
      if (stopOutcome === "timeout") {
        if (epoch === automationEpoch) automationEpoch += 1;
        useConnectionStore.setState({
          status: {
            state: "Error",
            message:
              "Automatic fallback stopped because the previous transport did not shut down cleanly.",
            phase: "automatic-stop",
          },
          accessCodeRequired: false,
        });
        return;
      }
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
