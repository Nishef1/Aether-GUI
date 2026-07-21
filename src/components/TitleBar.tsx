import { useEffect, useMemo, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { check, type Update } from "@tauri-apps/plugin-updater"
import { relaunch } from "@tauri-apps/plugin-process"
import { Download, LoaderCircle, Maximize2, Minus, Settings, X } from "lucide-react"
import { useConnectionStore } from "@/state/connectionStore"
import { useCoreStore } from "@/state/coreStore"
import type { CoreKind } from "@/types/core"

const appWindow = getCurrentWindow()
const CORE_KINDS: CoreKind[] = ["aether", "singbox"]
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

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

function updaterError(error: unknown): string {
  return `App update failed: ${error instanceof Error ? error.message : String(error)}`
}

export function TitleBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const cores = useCoreStore((state) => state.cores)
  const refreshCore = useCoreStore((state) => state.refresh)
  const installAndUse = useCoreStore((state) => state.installAndUse)
  const connectionStatus = useConnectionStore((state) => state.status.state)
  const [appUpdate, setAppUpdate] = useState<Update | null>(null)
  const [isElevated, setIsElevated] = useState(false)
  const [updateStage, setUpdateStage] = useState<string | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const checkInFlight = useRef(false)

  const coreUpdates = useMemo<CoreUpdate[]>(() => CORE_KINDS.flatMap((kind) => {
    const entry = cores[kind]
    const latest = entry.releases.find((release) => !release.prerelease)
    const current = entry.status?.active_version ?? entry.status?.bundled_version
    if (!latest || !current || !versionIsNewer(latest.version, current)) return []
    return [{ kind, version: latest.version }]
  }), [cores])

  useEffect(() => {
    let active = true
    const checkForUpdates = async () => {
      if (checkInFlight.current) return
      checkInFlight.current = true
      try {
        const elevated = await invoke<boolean>("get_is_elevated").catch(() => false)
        if (!active) return
        setIsElevated(elevated)
        // Never query, download, or install updates from the UAC-elevated TUN
        // process. It intentionally has no broader network-update authority.
        if (elevated) return

        const availableAppUpdate = await check()
        if (!active) return
        setAppUpdate(availableAppUpdate)
        // An application update takes precedence. Do not offer a potentially
        // incompatible core to the older UI immediately before replacing it.
        if (availableAppUpdate) return
        await Promise.all([refreshCore("aether", true), refreshCore("singbox", true)])
      } catch {
        // Update discovery is opportunistic and must never affect connectivity.
      } finally {
        checkInFlight.current = false
      }
    }

    const initial = window.setTimeout(() => void checkForUpdates(), 1200)
    const interval = window.setInterval(() => void checkForUpdates(), UPDATE_CHECK_INTERVAL_MS)
    return () => {
      active = false
      window.clearTimeout(initial)
      window.clearInterval(interval)
    }
  }, [refreshCore])

  const disconnected = connectionStatus === "Idle" || connectionStatus === "Error"
  const hasCoreUpdates = coreUpdates.length > 0
  const hasAppUpdate = appUpdate !== null
  const hasUpdate = hasAppUpdate || hasCoreUpdates
  const canUpdateCores = hasCoreUpdates && disconnected && !isElevated && !hasAppUpdate
  const isUpdating = updateStage !== null

  const updateLabel = hasAppUpdate ? "Update app" : coreUpdates.length > 1 ? "Update cores" : "Update core"
  const updateTitle = updateError
    ?? (isElevated
      ? "Restart Aether-GUI normally before checking for updates"
      : !disconnected
        ? "Disconnect before updating"
        : hasAppUpdate
          ? `Aether-GUI ${appUpdate.version} is available`
          : coreUpdates.map((update) => `${update.kind} ${update.version}`).join(" · "))

  const handleUpdate = async () => {
    if (isUpdating || isElevated || !disconnected) return
    setUpdateError(null)
    try {
      if (appUpdate) {
        let downloaded = 0
        let total = 0
        setUpdateStage("Downloading…")
        await appUpdate.downloadAndInstall((event) => {
          if (event.event === "Started") {
            total = event.data.contentLength ?? 0
            setUpdateStage("Downloading…")
          } else if (event.event === "Progress") {
            downloaded += event.data.chunkLength
            const percent = total > 0 ? ` ${Math.min(100, Math.round((downloaded / total) * 100))}%` : ""
            setUpdateStage(`Downloading…${percent}`)
          } else if (event.event === "Finished") {
            setUpdateStage("Installing…")
          }
        })
        // On Windows installation exits the app; this is kept for other
        // platforms and for a future non-Windows bundle.
        setUpdateStage("Restarting…")
        await relaunch()
        return
      }

      if (canUpdateCores) {
        setUpdateStage("Updating cores…")
        for (const update of coreUpdates) await installAndUse(update.kind, update.version)
        setUpdateStage(null)
      }
    } catch (error) {
      setUpdateError(appUpdate ? updaterError(error) : String(error))
      setUpdateStage(null)
    }
  }

  const buttonDisabled = isUpdating || isElevated || !disconnected || (!hasAppUpdate && hasCoreUpdates && !canUpdateCores)

  return (
    <header data-tauri-drag-region className="relative z-40 flex h-9 shrink-0 select-none items-center justify-end">
      {hasUpdate && (
        <button type="button" disabled={buttonDisabled} title={updateTitle} aria-label={updateStage ?? updateLabel}
          aria-describedby={updateError ? "update-error" : undefined}
          className="mr-1 flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void handleUpdate()}>
          {isUpdating ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <Download className="size-3.5" aria-hidden="true" />}
          <span>{updateStage ?? updateLabel}</span>
        </button>
      )}
      {updateError && <span id="update-error" role="alert" className="sr-only">{updateError}</span>}
      <button type="button" aria-label="Open settings" className="grid h-full w-11 place-items-center text-muted-foreground hover:bg-surface-2 hover:text-foreground" onClick={onOpenSettings}><Settings className="size-3.5" /></button>
      <button type="button" aria-label="Minimize" className="grid h-full w-13 place-items-center text-muted-foreground hover:bg-surface-2 hover:text-foreground" onClick={() => void appWindow.minimize()}><Minus className="size-4" /></button>
      <button type="button" aria-label="Maximize" className="grid h-full w-13 place-items-center text-muted-foreground hover:bg-surface-2 hover:text-foreground" onClick={() => void appWindow.toggleMaximize()}><Maximize2 className="size-3.5" /></button>
      <button type="button" aria-label="Close" className="grid h-full w-13 place-items-center text-muted-foreground hover:bg-destructive hover:text-white" onClick={() => void appWindow.close()}><X className="size-4" /></button>
    </header>
  )
}
