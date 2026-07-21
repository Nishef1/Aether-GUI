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
    operation: () => Promise<unknown>
  ): Promise<void> => {
    patchEntry(kind, { loading: true, error: null })
    try {
      await operation()
      await get().loadLocal(kind, true)
    } catch (error) {
      patchEntry(kind, { loading: false, error: String(error) })
      throw error
    }
  }

  return {
    cores: {
      aether: emptyEntry(),
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
          patchEntry(kind, { status, loading: false, loaded: true })
        } catch (error) {
          patchEntry(kind, {
            loading: false,
            loaded: true,
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
        await get().loadLocal(kind)
        patchEntry(kind, { loading: true, error: null })

        let releases: CoreRelease[] = []
        let error: string | null = null
        try {
          releases = await invoke<CoreRelease[]>("list_core_versions", { kind })
        } catch (releaseError) {
          error = `Online release list unavailable: ${String(releaseError)}`
        }

        patchEntry(kind, {
          releases,
          loading: false,
          onlineLoaded: true,
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
      await Promise.all([get().loadLocal("aether"), get().loadLocal("singbox")])
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
