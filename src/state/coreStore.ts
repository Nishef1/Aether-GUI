import { invoke } from "@tauri-apps/api/core"
import { create } from "zustand"
import type { CoreKind, CoreRelease, CoreStatus } from "@/types/core"

interface CoreEntry {
  releases: CoreRelease[]
  status: CoreStatus | null
  loading: boolean
  loaded: boolean
  onlineLoaded: boolean
  error: string | null
}

interface CoreStore {
  cores: Record<CoreKind, CoreEntry>
  loadLocal: (kind: CoreKind, force?: boolean) => Promise<void>
  refresh: (kind: CoreKind, force?: boolean) => Promise<void>
  loadAll: () => Promise<void>
  installAndUse: (kind: CoreKind, version: string) => Promise<void>
  selectVersion: (kind: CoreKind, version: string) => Promise<void>
  removeVersion: (kind: CoreKind, version: string) => Promise<void>
}

const emptyEntry = (): CoreEntry => ({
  releases: [],
  status: null,
  loading: false,
  loaded: false,
  onlineLoaded: false,
  error: null,
})

function reconcileReleases(
  releases: CoreRelease[],
  status: CoreStatus
): CoreRelease[] {
  const installed = new Set(status.installed_versions)
  return releases.map((release) => ({
    ...release,
    installed: installed.has(release.version),
    active: status.active_version === release.version,
  }))
}

// Keep one request per core so opening panels or clicking repeatedly never
// duplicates local I/O or an online GitHub request.
const localInFlight: Partial<Record<CoreKind, Promise<void>>> = {}
const refreshInFlight: Partial<Record<CoreKind, Promise<void>>> = {}

export const useCoreStore = create<CoreStore>((set, get) => {
  const patchEntry = (kind: CoreKind, patch: Partial<CoreEntry>) => {
    set((state) => ({
      cores: {
        ...state.cores,
        [kind]: { ...state.cores[kind], ...patch },
      },
    }))
  }

  const runMutation = async (
    kind: CoreKind,
    operation: () => Promise<CoreStatus>
  ): Promise<void> => {
    patchEntry(kind, { loading: true, error: null })
    try {
      // Mutation commands return authoritative post-mutation status. Reconcile
      // the cached release flags immediately so Install/Use/active labels never
      // remain stale until the next online refresh.
      const status = await operation()
      const releases = reconcileReleases(get().cores[kind].releases, status)
      patchEntry(kind, {
        status,
        releases,
        loading: false,
        loaded: true,
      })
    } catch (error) {
      patchEntry(kind, { loading: false, error: String(error) })
      throw error
    }
  }

  return {
    cores: {
      aether: emptyEntry(),
      xray: emptyEntry(),
      singbox: emptyEntry(),
    },

    loadLocal: (kind, force = false) => {
      const existing = localInFlight[kind]
      if (existing) return existing
      if (!force && get().cores[kind].loaded) return Promise.resolve()

      const request = (async () => {
        patchEntry(kind, { loading: true, error: null })
        try {
          const status = await invoke<CoreStatus>("get_core_status", { kind })
          patchEntry(kind, {
            status,
            releases: reconcileReleases(get().cores[kind].releases, status),
            loading: false,
            loaded: true,
          })
        } catch (error) {
          // A transient IPC or filesystem failure must remain retryable. Marking
          // this as loaded used to make every later panel open a permanent no-op.
          patchEntry(kind, {
            loading: false,
            loaded: false,
            error: String(error),
          })
        }
      })()

      localInFlight[kind] = request
      void request.finally(() => {
        delete localInFlight[kind]
      })
      return request
    },

    refresh: (kind, force = false) => {
      const existing = refreshInFlight[kind]
      if (existing) return existing
      if (!force && get().cores[kind].onlineLoaded) return Promise.resolve()

      const request = (async () => {
        // A manual refresh must also retry local status. Otherwise a single
        // startup IPC failure leaves the version selector without authoritative
        // installed/active information for the rest of the process lifetime.
        await get().loadLocal(kind, force)
        const localError = get().cores[kind].status
          ? null
          : get().cores[kind].error
        patchEntry(kind, { loading: true, error: localError })

        let releases = get().cores[kind].releases
        let releaseError: string | null = null
        try {
          const fetched = await invoke<CoreRelease[]>("list_core_versions", { kind })
          const status = get().cores[kind].status
          releases = status ? reconcileReleases(fetched, status) : fetched
        } catch (error) {
          // Keep the last known list usable while offline instead of erasing it.
          releaseError = `Online release list unavailable: ${String(error)}`
        }

        const error = [localError, releaseError].filter(Boolean).join(" · ") || null
        patchEntry(kind, {
          releases,
          loading: false,
          onlineLoaded: releaseError === null,
          error,
        })
      })()

      refreshInFlight[kind] = request
      void request.finally(() => {
        delete refreshInFlight[kind]
      })
      return request
    },

    loadAll: async () => {
      await Promise.all([
        get().loadLocal("aether"),
        get().loadLocal("xray"),
        get().loadLocal("singbox"),
      ])
    },

    installAndUse: (kind, version) =>
      runMutation(kind, () =>
        invoke<CoreStatus>("install_core_version", { kind, version })
      ),

    selectVersion: (kind, version) =>
      runMutation(kind, () =>
        invoke<CoreStatus>("select_core_version", { kind, version })
      ),

    removeVersion: (kind, version) =>
      runMutation(kind, () =>
        invoke<CoreStatus>("remove_core_version", { kind, version })
      ),
  }
})
