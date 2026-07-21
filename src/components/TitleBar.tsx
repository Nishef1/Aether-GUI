import { useEffect, useMemo, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { Download, LoaderCircle, Maximize2, Minus, Settings, X } from "lucide-react"
import { useConnectionStore } from "@/state/connectionStore"
import { useCoreStore } from "@/state/coreStore"
import type { CoreKind } from "@/types/core"

const appWindow = getCurrentWindow()
const CORE_KINDS: CoreKind[] = ["aether", "singbox"]
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

interface AppUpdateInfo {
  current_version: string
  latest_version: string
  release_url: string
}

interface CoreUpdate {
  kind: CoreKind
  version: string
}

function versionParts(value: string): number[] | null {
  const match = value.trim().replace(/^v/i, "").match(/^\d+(?:\.\d+)*/)
  if (!match) return null
  return match[0].split(".").map(Number)
}

function versionIsNewer(candidate: string, current: string): boolean {
  const next = versionParts(candidate)
  const active = versionParts(current)
  if (!next || !active) return candidate !== current
  const width = Math.max(next.length, active.length)
  for (let index = 0; index < width; index += 1) {
    const left = next[index] ?? 0
    const right = active[index] ?? 0
    if (left !== right) return left > right
  }
  return false
}

export function TitleBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const cores = useCoreStore((state) => state.cores)
  const refreshCore = useCoreStore((state) => state.refresh)
  const installAndUse = useCoreStore((state) => state.installAndUse)
  const connectionStatus = useConnectionStore((state) => state.status.state)
  const [appUpdate, setAppUpdate] = useState<AppUpdateInfo | null>(null)
  const [isElevated, setIsElevated] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)

  const coreUpdates = useMemo<CoreUpdate[]>(() => {
    return CORE_KINDS.flatMap((kind) => {
      const entry = cores[kind]
      const latest = entry.releases.find((release) => !release.prerelease)
      const current = entry.status?.active_version ?? entry.status?.bundled_version
      if (!latest || !current || !versionIsNewer(latest.version, current)) return []
      return [{ kind, version: latest.version }]
    })
  }, [cores])

  useEffect(() => {
    let active = true

    const checkForUpdates = async () => {
      const [, , appResult, elevatedResult] = await Promise.allSettled([
        refreshCore("aether", true),
        refreshCore("singbox", true),
        invoke<AppUpdateInfo | null>("check_app_update"),
        invoke<boolean>("get_is_elevated"),
      ])
      if (!active) return
      if (appResult.status === "fulfilled") setAppUpdate(appResult.value)
      if (elevatedResult.status === "fulfilled") setIsElevated(elevatedResult.value)
    }

    const initial = window.setTimeout(() => void checkForUpdates(), 1200)
    const interval = window.setInterval(
      () => void checkForUpdates(),
      UPDATE_CHECK_INTERVAL_MS
    )
    return () => {
      active = false
      window.clearTimeout(initial)
      window.clearInterval(interval)
    }
  }, [refreshCore])

  const disconnected = connectionStatus === "Idle" || connectionStatus === "Error"
  const hasCoreUpdates = coreUpdates.length > 0
  const hasUpdate = Boolean(appUpdate) || hasCoreUpdates
  const canUpdateCores = hasCoreUpdates && disconnected && !isElevated

  const updateLabel = appUpdate && hasCoreUpdates
    ? "Updates"
    : appUpdate
      ? "Update app"
      : coreUpdates.length > 1
        ? "Update cores"
        : "Update core"

  const updateTitle = updateError
    ? updateError
    : appUpdate && hasCoreUpdates
      ? `Aether-GUI ${appUpdate.latest_version} and ${coreUpdates.length} core update${coreUpdates.length > 1 ? "s" : ""} available`
      : appUpdate
        ? `Aether-GUI ${appUpdate.latest_version} is available`
        : !disconnected
          ? "Disconnect before updating cores"
          : isElevated
            ? "Restart Aether-GUI normally before updating cores"
            : coreUpdates.map((update) => `${update.kind} ${update.version}`).join(" · ")

  const handleUpdate = async () => {
    setUpdateError(null)
    setUpdating(true)

    try {
      if (canUpdateCores) {
        for (const update of coreUpdates) {
          await installAndUse(update.kind, update.version)
          const error = useCoreStore.getState().cores[update.kind].error
          if (error) throw new Error(error)
        }
      }

      if (appUpdate) {
        await invoke("open_app_update", { releaseUrl: appUpdate.release_url })
      }
    } catch (error) {
      setUpdateError(String(error))
    } finally {
      setUpdating(false)
    }
  }

  const buttonDisabled = updating || (!appUpdate && hasCoreUpdates && !canUpdateCores)

  return (
    <header
      data-tauri-drag-region
      className="relative z-40 flex h-9 shrink-0 select-none items-center justify-end"
    >
      {hasUpdate && (
        <button
          type="button"
          disabled={buttonDisabled}
          title={updateTitle}
          aria-label={updateLabel}
          className="mr-1 flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void handleUpdate()}
        >
          {updating ? (
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="size-3.5" aria-hidden="true" />
          )}
          <span>{updating ? "Updating…" : updateLabel}</span>
        </button>
      )}
      <button
        type="button"
        aria-label="Open settings"
        className="grid h-full w-11 place-items-center text-muted-foreground hover:bg-surface-2 hover:text-foreground"
        onClick={onOpenSettings}
      >
        <Settings className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="Minimize"
        className="grid h-full w-13 place-items-center text-muted-foreground hover:bg-surface-2 hover:text-foreground"
        onClick={() => void appWindow.minimize()}
      >
        <Minus className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Maximize"
        className="grid h-full w-13 place-items-center text-muted-foreground hover:bg-surface-2 hover:text-foreground"
        onClick={() => void appWindow.toggleMaximize()}
      >
        <Maximize2 className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="Close"
        className="grid h-full w-13 place-items-center text-muted-foreground hover:bg-destructive hover:text-white"
        onClick={() => void appWindow.close()}
      >
        <X className="size-4" />
      </button>
    </header>
  )
}
