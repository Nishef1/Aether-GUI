export type PathHealth = "healthy" | "suspect" | "failed";

export interface ObservedPath {
  id: string;
  endpoint: string;
  transport: "h2" | "h3" | "wg" | "gool" | "unknown";
  health: PathHealth;
  successes: number;
  failures: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  confidence: number;
  latencyMs: number | null;
}

const MAX_PATHS = 32;

export function scorePath(path: ObservedPath): number {
  const reliability = path.successes + path.failures === 0
    ? 0
    : path.successes / (path.successes + path.failures);

  const latencyPenalty = path.latencyMs == null
    ? 0
    : Math.min(path.latencyMs / 1000, 1);

  const healthBonus = path.health === "healthy"
    ? 1
    : path.health === "suspect"
      ? 0.4
      : 0;

  return Math.max(0, reliability * 0.5 + path.confidence * 0.3 + healthBonus * 0.2 - latencyPenalty * 0.1);
}

export function rankPaths(paths: ObservedPath[]): ObservedPath[] {
  return [...paths]
    .sort((a, b) => scorePath(b) - scorePath(a))
    .slice(0, MAX_PATHS);
}
