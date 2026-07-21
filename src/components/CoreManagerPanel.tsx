import { useEffect, useMemo, useState } from "react"
import { Download, RefreshCw, Trash2 } from "lucide-react"
import { useConnectionStore } from "@/state/connectionStore"
import { useCoreStore } from "@/state/coreStore"
import type { CoreKind, CoreRelease } from "@/types/core"

const CORE_LABELS: Record<CoreKind, string> = {
  aether: "Aether core",
  singbox: "sing-box TUN core",
}

function CoreCard({ kind }: { kind: CoreKind }) {
  const entry = useCoreStore((state) => state.cores[kind])
  const refresh = useCoreStore((state) => state.refresh)
  const installAndUse = useCoreStore((state) => state.installAndUse)
  const selectVersion = useCoreStore((state) => state.selectVersion)
  const removeVersion = useCoreStore((state) => state.removeVersion)
  const connectionStatus = useConnectionStore((state) => state.status.state)
  const locked = connectionStatus !== "Idle" && connectionStatus !== "Error"

  const releases = useMemo(() => {
    const byVersion = new Map<string, CoreRelease>()
    for (const release of entry.releases)
      byVersion.set(release.version, release)
    for (const version of entry.status?.installed_versions ?? []) {
      if (!byVersion.has(version)) {
        byVersion.set(version, {
          version,
          prerelease: false,
          installed: true,
          active: entry.status?.active_version === version,
        })
      }
    }
    return [...byVersion.values()]
  }, [entry.releases, entry.status])

  const latestStable = useMemo(
    () =>
      entry.releases.find((release) => !release.prerelease)?.version ?? null,
    [entry.releases]
  )
  const bundledVersion = entry.status?.bundled_version ?? null
  const fallbackSelection =
    entry.status?.active_version ?? bundledVersion ?? latestStable ?? ""
  const [selectionOverride, setSelectionOverride] = useState<string | null>(
    null
  )
  const selected =
    selectionOverride &&
    (selectionOverride === bundledVersion ||
      releases.some((release) => release.version === selectionOverride))
      ? selectionOverride
      : fallbackSelection

  const selectedRelease = releases.find(
    (release) => release.version === selected
  )
  const installed =
    selectedRelease?.installed ??
    entry.status?.installed_versions.includes(selected) ??
    false
  const bundledSelected = Boolean(
    bundledVersion && selected === bundledVersion && !installed
  )
  const active = entry.status?.active_version === selected

  const useSelectedVersion = () => {
    if (bundledSelected) return
    const action = installed ? selectVersion : installAndUse
    void action(kind, selected).catch(() => {
      // The store preserves the message in entry.error for inline display.
    })
  }

  const removeSelectedVersion = () => {
    void removeVersion(kind, selected).catch(() => {
      // The store preserves the message in entry.error for inline display.
    })
  }

  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-foreground">
            {CORE_LABELS[kind]}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {entry.status?.active_version
              ? `Active managed: ${entry.status.active_version}`
              : bundledVersion
                ? `Bundled baseline: ${bundledVersion}`
                : "No bundled or managed core detected"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh(kind, true)}
          disabled={entry.loading}
          className="rounded-md p-1.5 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
          aria-label={`Refresh ${CORE_LABELS[kind]} releases`}
        >
          <RefreshCw
            size={14}
            className={entry.loading ? "animate-spin" : ""}
          />
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
          {bundledVersion && (
            <option value={bundledVersion}>
              {bundledVersion} — bundled baseline
            </option>
          )}
          {releases
            .filter((release) => release.version !== bundledVersion)
            .map((release) => (
              <option key={release.version} value={release.version}>
                {release.version}
                {release.prerelease ? " (pre-release)" : ""}
                {release.active
                  ? " — active"
                  : release.installed
                    ? " — installed"
                    : ""}
              </option>
            ))}
        </select>

        <button
          type="button"
          disabled={
            !selected || bundledSelected || active || entry.loading || locked
          }
          onClick={useSelectedVersion}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
        >
          <Download size={13} />
          {bundledSelected ? "Bundled" : installed ? "Use" : "Install"}
        </button>

        <button
          type="button"
          disabled={
            !selected ||
            bundledSelected ||
            !installed ||
            active ||
            entry.loading ||
            locked
          }
          onClick={removeSelectedVersion}
          className="rounded-md p-1.5 text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-30"
          aria-label={`Remove ${CORE_LABELS[kind]} ${selected}`}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {latestStable && (
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          Latest stable: {latestStable}
        </p>
      )}
      {entry.error && (
        <p className="mt-1.5 text-[10px] text-destructive">{entry.error}</p>
      )}
      {locked && (
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          Disconnect before changing core versions.
        </p>
      )}
    </div>
  )
}

export function CoreManagerPanel() {
  const loadAll = useCoreStore((state) => state.loadAll)

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="text-xs font-medium text-foreground">Core management</p>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Bundled baseline cores are available without a separate install. Managed
          versions can be installed side-by-side and selected while disconnected.
          Use refresh to check recent online releases.
        </p>
      </div>
      <CoreCard kind="aether" />
      <CoreCard kind="singbox" />
    </div>
  )
}
