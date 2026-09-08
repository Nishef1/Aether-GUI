export type ConnectionHealthState = "healthy" | "suspect" | "failed";

export interface ConnectionHealthSnapshot {
  state: ConnectionHealthState;
  lastTransition: number;
  lastSuccess: number | null;
  failures: number;
  reason?: string;
}

const MAX_FAILURES_BEFORE_FAILED = 3;

export function createConnectionHealth(): ConnectionHealthSnapshot {
  return {
    state: "suspect",
    lastTransition: Date.now(),
    lastSuccess: null,
    failures: 0,
  };
}

export function markConnectionHealthy(
  snapshot: ConnectionHealthSnapshot,
): ConnectionHealthSnapshot {
  return {
    ...snapshot,
    state: "healthy",
    lastTransition: Date.now(),
    lastSuccess: Date.now(),
    failures: 0,
    reason: undefined,
  };
}

export function markConnectionFailure(
  snapshot: ConnectionHealthSnapshot,
  reason: string,
): ConnectionHealthSnapshot {
  const failures = snapshot.failures + 1;
  return {
    ...snapshot,
    state: failures >= MAX_FAILURES_BEFORE_FAILED ? "failed" : "suspect",
    lastTransition: Date.now(),
    failures,
    reason,
  };
}
