import { invoke } from "@tauri-apps/api/core";
import {
  automaticAttemptBudgetMs,
  buildAutomaticCandidates,
  type AutomaticCandidate,
} from "@/lib/automaticPolicy";
import { profileForNativeInvoke } from "@/lib/nativeProfile";
import { isAndroid } from "@/lib/platform";
import { useAutomaticRuntimeStore } from "@/state/automaticRuntimeStore";
import { useConnectionStore } from "@/state/connectionStore";
import {
  recordPathAcceptanceFailure,
  refreshPathNetworkContext,
  usePathStore,
  type PathAcceptanceFailure,
} from "@/state/pathStore";
import type { ConnectionProfile, ConnectionStatus } from "@/types/connection";

const RECONCILE_MS = 750;
const STOP_TIMEOUT_MS = 8_000;
const ANDROID_ACCEPTANCE_GRACE_MS = 5_000;

let automationEpoch = 0;

type StopOutcome = "stopped" | "cancelled" | "timeout";
type AutomaticFailureReason =
  | "h3-unavailable"
  | "tcp-unreachable"
  | "tls-blocked"
  | "h2-rejected"
  | "dataplane-failed"
  | "upload-limited"
  | "identity-leak"
  | "unknown";

type AcceptanceStatus = "unverified" | "protected" | "degraded" | "leak_detected";

interface ConnectionAcceptanceReport {
  status: AcceptanceStatus;
  public_ipv4: string | null;
  public_ipv6: string | null;
  ipv4_protected: boolean | null;
  ipv6_protected: boolean | null;
  download_kbps: number | null;
  upload_kbps: number | null;
  upload_limited: boolean;
  reason: string | null;
}

interface AcceptanceDecision {
  accepted: boolean;
  cancelled: boolean;
  reason: AutomaticFailureReason;
  message: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stable(status: ConnectionStatus): boolean {
  return status.state === "Connected" || status.state === "Tunneling";
}

function stableSocksAddress(status: ConnectionStatus): string | null {
  switch (status.state) {
    case "Connected":
    case "Tunneling":
      return status.socks_addr;
    default:
      return null;
  }
}

function attemptIsCurrent(epoch: number, attemptId: number): boolean {
  return epoch === automationEpoch && useConnectionStore.getState().attemptId === attemptId;
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

function isPathAcceptanceFailure(
  reason: AutomaticFailureReason,
): reason is PathAcceptanceFailure {
  return (
    reason === "upload-limited" ||
    reason === "identity-leak" ||
    reason === "dataplane-failed"
  );
}

function classifyAutomaticFailure(
  message: string,
  candidate: AutomaticCandidate,
): AutomaticFailureReason {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("identical to the public underlay") ||
    normalized.includes("unprotected network identity") ||
    normalized.includes("identity leak")
  ) {
    return "identity-leak";
  }
  if (normalized.includes("upload") && normalized.includes("throttl")) {
    return "upload-limited";
  }
  if (
    normalized.includes("data-plane") ||
    normalized.includes("data plane") ||
    normalized.includes("matching dns reply") ||
    normalized.includes("egress failed") ||
    normalized.includes("end-to-end")
  ) {
    return "dataplane-failed";
  }
  if (
    candidate.transport === "h2" &&
    (normalized.includes("connect-ip status") ||
      normalized.includes("http/2") ||
      normalized.includes("h2 connect"))
  ) {
    return "h2-rejected";
  }
  if (
    candidate.transport === "h2" &&
    (normalized.includes("clienthello") ||
      normalized.includes("tls handshake") ||
      normalized.includes("tls alert") ||
      normalized.includes("certificate"))
  ) {
    return "tls-blocked";
  }
  if (
    candidate.transport === "h3" &&
    (normalized.includes("quic") ||
      normalized.includes("udp") ||
      normalized.includes("h3") ||
      normalized.includes("timed out"))
  ) {
    return "h3-unavailable";
  }
  if (
    normalized.includes("connection refused") ||
    normalized.includes("tcp connect") ||
    normalized.includes("network is unreachable") ||
    normalized.includes("no route to host")
  ) {
    return "tcp-unreachable";
  }
  return "unknown";
}

function reprioritizeRemainingCandidates(
  candidates: AutomaticCandidate[],
  startIndex: number,
  reason: AutomaticFailureReason,
  failedTransport: AutomaticCandidate["transport"],
): void {
  if (startIndex >= candidates.length || reason === "unknown") return;

  const score = (candidate: AutomaticCandidate): number => {
    switch (reason) {
      case "h3-unavailable":
        if (candidate.transport === "h2") return 0;
        if (candidate.transport === "wg") return 1;
        if (candidate.transport === "gool") return 2;
        return 3;
      case "tls-blocked":
        if (candidate.transport === "h2" && candidate.profile.masque_mask !== "off") return 0;
        if (candidate.transport !== "h2") return 1;
        return 3;
      case "h2-rejected":
      case "tcp-unreachable":
        return candidate.transport === "h2" ? 2 : 0;
      case "identity-leak":
      case "upload-limited":
      case "dataplane-failed":
        return candidate.transport === failedTransport ? 1 : 0;
    }
  };

  const reordered = candidates
    .slice(startIndex)
    .map((candidate, offset) => ({ candidate, offset, score: score(candidate) }))
    .sort((left, right) => left.score - right.score || left.offset - right.offset)
    .map(({ candidate }) => candidate);
  candidates.splice(startIndex, reordered.length, ...reordered);
}

async function reconcileStatus(
  epoch: number,
  attemptId: number,
): Promise<ConnectionStatus | null> {
  try {
    const status = await invoke<ConnectionStatus>("get_status");
    if (!attemptIsCurrent(epoch, attemptId)) return null;
    useConnectionStore.setState({ status });
    return status;
  } catch {
    if (!attemptIsCurrent(epoch, attemptId)) return null;
    return useConnectionStore.getState().status;
  }
}

async function waitForOutcome(
  epoch: number,
  attemptId: number,
  budgetMs: number,
): Promise<"connected" | "failed" | "cancelled" | "timeout"> {
  let deadline = Date.now() + budgetMs;
  while (attemptIsCurrent(epoch, attemptId)) {
    const status = await reconcileStatus(epoch, attemptId);
    if (status == null) return "cancelled";
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

async function verifyConnectedCandidate(
  epoch: number,
  attemptId: number,
  candidate: AutomaticCandidate,
): Promise<AcceptanceDecision> {
  if (!attemptIsCurrent(epoch, attemptId)) {
    return { accepted: false, cancelled: true, reason: "unknown", message: null };
  }

  if (isAndroid) {
    const deadline = Date.now() + ANDROID_ACCEPTANCE_GRACE_MS;
    while (Date.now() < deadline && attemptIsCurrent(epoch, attemptId)) {
      const connection = useConnectionStore.getState();
      if (
        connection.runtimeCapacityAttemptId === attemptId &&
        connection.runtimeCapacity != null
      ) {
        if (connection.runtimeCapacity.uploadLimited) {
          return {
            accepted: false,
            cancelled: false,
            reason: "upload-limited",
            message: `${candidate.label} connected but the native acceptance probe detected severe upload throttling`,
          };
        }
        return { accepted: true, cancelled: false, reason: "unknown", message: null };
      }
      await sleep(250);
    }
    return attemptIsCurrent(epoch, attemptId)
      ? { accepted: true, cancelled: false, reason: "unknown", message: null }
      : { accepted: false, cancelled: true, reason: "unknown", message: null };
  }

  const status = useConnectionStore.getState().status;
  const socksAddr = stableSocksAddress(status);
  if (socksAddr == null) {
    return {
      accepted: false,
      cancelled: false,
      reason: "dataplane-failed",
      message: `${candidate.label} lost its stable SOCKS endpoint before acceptance verification`,
    };
  }

  let report: ConnectionAcceptanceReport;
  try {
    report = await invoke<ConnectionAcceptanceReport>("probe_connection_acceptance", {
      socksAddr,
    });
  } catch (error) {
    return attemptIsCurrent(epoch, attemptId)
      ? { accepted: true, cancelled: false, reason: "unknown", message: String(error) }
      : { accepted: false, cancelled: true, reason: "unknown", message: null };
  }

  if (!attemptIsCurrent(epoch, attemptId)) {
    return { accepted: false, cancelled: true, reason: "unknown", message: null };
  }

  if (report.status === "leak_detected") {
    return {
      accepted: false,
      cancelled: false,
      reason: "identity-leak",
      message: report.reason ?? `${candidate.label} failed egress identity verification`,
    };
  }
  if (report.status === "degraded" && report.upload_limited) {
    return {
      accepted: false,
      cancelled: false,
      reason: "upload-limited",
      message: report.reason ?? `${candidate.label} has severe upload throttling`,
    };
  }

  // Public probe infrastructure is an additional guard. Unavailable neutral
  // probes do not convert a transport that already passed native validation
  // into a false negative.
  return { accepted: true, cancelled: false, reason: "unknown", message: report.reason };
}

async function stopCandidateForFallback(epoch: number, attemptId: number): Promise<StopOutcome> {
  // Both desktop and Android expose the same recovery-only command. Each
  // native implementation stops the transport while preserving an already
  // active full-device route as a fail-closed kill switch.
  await invoke("disconnect_for_recovery").catch(() => undefined);
  if (!attemptIsCurrent(epoch, attemptId)) return "cancelled";

  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!attemptIsCurrent(epoch, attemptId)) return "cancelled";
    const status = await reconcileStatus(epoch, attemptId);
    if (status == null) return "cancelled";
    if (status.state === "Idle" || status.state === "Error") return "stopped";
    await sleep(200);
  }
  return attemptIsCurrent(epoch, attemptId) ? "timeout" : "cancelled";
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

async function persistSuccessfulAutomaticIntent(profile: ConnectionProfile): Promise<string | null> {
  if (profile.runtime_only) return null;
  try {
    // Persist the semantic user profile only after a candidate has passed
    // acceptance. This keeps desktop `last_successful_profile` truthful while
    // still preventing the concrete candidate from replacing Automatic.
    await invoke("set_default_profile", {
      profile: { ...profile, runtime_only: false },
    });
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
    const attemptId = prepareAttempt(base, budgetMs, singleProfileLabel(base), 1, 1);
    const launchError = await invokeCandidate(base);
    if (useConnectionStore.getState().attemptId !== attemptId) return;
    if (launchError != null) publishLaunchError(launchError, "launching");
    return;
  }

  const epoch = ++automationEpoch;
  useConnectionStore.setState({
    status: { state: "Launching" },
    accessCodeRequired: false,
    sidecarError: null,
  });

  // Historical ordering is only safe after the current underlay fingerprint is
  // resolved. Unknown context intentionally falls back to baseline ordering.
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
    const attemptId = prepareAttempt(
      candidate.profile,
      budgetMs,
      candidate.label,
      index + 1,
      candidates.length,
    );

    let failureReason: AutomaticFailureReason;
    const launchError = await invokeCandidate(candidate.profile);
    if (!attemptIsCurrent(epoch, attemptId)) return;

    if (launchError != null) {
      lastError = launchError;
      failureReason = classifyAutomaticFailure(launchError, candidate);
      if (binaryUnavailable(launchError)) {
        publishLaunchError(launchError, "launching");
        return;
      }
    } else {
      const outcome = await waitForOutcome(epoch, attemptId, budgetMs);
      if (outcome === "connected") {
        const acceptance = await verifyConnectedCandidate(epoch, attemptId, candidate);
        if (acceptance.cancelled) return;
        if (acceptance.accepted) {
          const persistenceError = await persistSuccessfulAutomaticIntent(base);
          if (!attemptIsCurrent(epoch, attemptId)) return;
          if (persistenceError != null) {
            // The protected route is valid; a settings write failure must not
            // tear it down. Surface the failure without lying about connectivity.
            console.error("Failed to persist successful Automatic profile:", persistenceError);
          }
          if (attemptIsCurrent(epoch, attemptId)) automationEpoch += 1;
          return;
        }
        failureReason = acceptance.reason;
        lastError = acceptance.message ?? `${candidate.label} failed post-connect acceptance`;
        if (isPathAcceptanceFailure(failureReason)) {
          recordPathAcceptanceFailure(attemptId, failureReason);
        }
      } else {
        if (outcome === "cancelled") return;
        if (!attemptIsCurrent(epoch, attemptId)) return;
        const status = useConnectionStore.getState().status;
        lastError =
          status.state === "Error"
            ? status.message
            : `${candidate.label} did not finish within its bounded scan window`;
        failureReason = classifyAutomaticFailure(lastError, candidate);
      }
    }

    if (!attemptIsCurrent(epoch, attemptId)) return;
    reprioritizeRemainingCandidates(candidates, index + 1, failureReason, candidate.transport);

    const stopOutcome = await stopCandidateForFallback(epoch, attemptId);
    if (stopOutcome === "cancelled") return;
    if (stopOutcome === "timeout") {
      if (attemptIsCurrent(epoch, attemptId)) automationEpoch += 1;
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

  if (epoch !== automationEpoch) return;
  automationEpoch += 1;
  useConnectionStore.setState({
    status: {
      state: "Error",
      message: `Automatic transport fallback exhausted: ${lastError}`,
      phase: "automatic-v3",
    },
    accessCodeRequired: false,
  });
}
