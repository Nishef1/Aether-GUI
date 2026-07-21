import { useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Trash2 } from "lucide-react";
import { useConnectionStore } from "@/state/connectionStore";
import { useCoreStore } from "@/state/coreStore";
import type { CoreKind, CoreRelease } from "@/types/core";

const CORE_LABELS: Record<CoreKind, string> = {
  aether: "Aether core",
  singbox: "sing-box TUN core",
};

function CoreCard({ kind }: { kind: CoreKind }) {
  const entry = useCoreStore((state) => state.cores[kind]);
  const refresh = useCoreStore((state) => state.refresh);
  const installAndUse = useCoreStore((state) => state.installAndUse);
  const selectVersion = useCoreStore((state) => state.selectVersion);
  const removeVersion = useCoreStore((state) => state.removeVersion);
  const connectionStatus = useConnectionStore((state) => state.status.state);
  const locked = connectionStatus !== "Idle" && connectionStatus !== "Error";

  const releases = useMemo(() => {
    const byVersion = new Map<string, CoreRelease>();
    for (const release of entry.releases) byVersion.set(release.version, release);
    for (const version of entry.status?.installed_versions ?? []) {
      if (!byVersion.has(version)) {
        byVersion.set(version, {
          version,
          prerelease: false,
          installed: true,
          active: entry.status?.active_version === version,
        });
      }
    }
    return [...byVersion.values()];
  }, [entry.releases, entry.status]);

  const latestStable = useMemo(
    () => entry.releases.find((release) => !release.prerelease)?.version ?? null,
    [entry.releases],
  );
  const fallbackSelection = entry.status?.active_version ?? latestStable ?? "";
  const [selectionOverride, setSelectionOverride] = useState<string | null>(null);
  const selected =
    selectionOverride && releases.some((release) => release.version === selectionOverride)
      ? selectionOverride
      : fallbackSelection;

  const selectedRelease = releases.find((release) => release.version === selected);
  const installed =
    selectedRelease?.installed ?? entry.status?.installed_versions.includes(selected) ?? false;
  const active = entry.status?.active_version === selected;

  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-foreground">{CORE_LABELS[kind]}</p>
          <p className="text-[10px] text-muted-foreground">
            Active:{" "}
            {entry.status?.active_version ?? `bundled ${entry.status?.bundled_version ?? "unknown"}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh(kind)}
          disabled={entry.loading}
          className="rounded-md p-1.5 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
          aria-label={`Refresh ${CORE_LABELS[kind]} releases`}
        >
          <RefreshCw size={14} className={entry.loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="flex gap-2">
        <select
          value={selected}
          onChange={(event) => setSelectionOverride(event.target.value)}
          disabled={entry.loading || locked}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
          aria-label={`${CORE_LABELS[kind]} version`}
        >
          {!selected && <option value="">Choose version</option>}
          {releases.map((release) => (
            <option key={release.version} value={release.version}>
              {release.version}
              {release.prerelease ? " (pre-release)" : ""}
              {release.active ? " — active" : release.installed ? " — installed" : ""}
            </option>
          ))}
        </select>

        <button
          type="button"
          disabled={!selected || active || entry.loading || locked}
          onClick={() =>
            void (installed ? selectVersion(kind, selected) : installAndUse(kind, selected))
          }
          className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
        >
          <Download size={13} />
          {installed ? "Use" : "Install"}
        </button>

        <button
          type="button"
          disabled={!selected || !installed || active || entry.loading || locked}
          onClick={() => void removeVersion(kind, selected)}
          className="rounded-md p-1.5 text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-30"
          aria-label={`Remove ${CORE_LABELS[kind]} ${selected}`}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {latestStable && (
        <p className="mt-1.5 text-[10px] text-muted-foreground">Latest stable: {latestStable}</p>
      )}
      {entry.error && <p className="mt-1.5 text-[10px] text-destructive">{entry.error}</p>}
      {locked && (
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          Disconnect before changing core versions.
        </p>
      )}
    </div>
  );
}

export function CoreManagerPanel() {
  const refresh = useCoreStore((state) => state.refresh);

  useEffect(() => {
    void Promise.all([refresh("aether"), refresh("singbox")]);
  }, [refresh]);

  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="text-xs font-medium text-foreground">Core management</p>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Install versions side-by-side and switch without replacing the GUI. A new core becomes
          active only after you select it; TUN versions are configuration-checked before routing is
          changed.
        </p>
      </div>
      <CoreCard kind="aether" />
      <CoreCard kind="singbox" />
    </div>
  );
}
