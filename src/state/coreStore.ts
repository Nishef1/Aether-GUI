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

export const useCoreStore = create<CoreStore>((set, get) => ({
  cores: {
    aether: emptyEntry(),
    singbox: emptyEntry(),
  },

  loadLocal: (kind, force = false) => {
    const existing = localInFlight[kind]
    if (existing) return existing
    if (!force && get().cores[kind].loaded) return Promise.resolve()

    const request = (async () => {
      set((state) => ({
        cores: {
          ...state.cores,
          [kind]: { ...state.cores[kind], loading: true, error: null },
        },
      }))

      try {
        const status = await invoke<CoreStatus>("get_core_status", { kind })
        set((state) => ({
          cores: {
            ...state.cores,
            [kind]: { ...state.cores[kind], status, loading: false, loaded: true },
          },
        }))
      } catch (error) {
        set((state) => ({
          cores: {
            ...state.cores,
            [kind]: { ...state.cores[kind], loading: false, loaded: true, error: String(error) },
          },
        }))
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
      set((state) => ({
        cores: {
          ...state.cores,
          [kind]: { ...state.cores[kind], loading: true, error: null },
        },
      }))

      let releases: CoreRelease[] = []
      let error: string | null = null

      try {
        releases = await invoke<CoreRelease[]>("list_core_versions", { kind })
      } catch (releaseError) {
        error ??= `Online release list unavailable: ${String(releaseError)}`
      }

      set((state) => ({
        cores: {
          ...state.cores,
          [kind]: {
            ...state.cores[kind],
            releases,
            loading: false,
            onlineLoaded: true,
            error,
          },
        },
      }))
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

  installAndUse: async (kind, version) => {
    set((state) => ({
      cores: {
        ...state.cores,
        [kind]: { ...state.cores[kind], loading: true, error: null },
      },
    }))
    try {
      await invoke<CoreStatus>("install_core_version", { kind, version })
      await get().loadLocal(kind, true)
    } catch (error) {
      set((state) => ({
        cores: {
          ...state.cores,
          [kind]: {
            ...state.cores[kind],
            loading: false,
            error: String(error),
          },
        },
      }))
    }
  },

  selectVersion: async (kind, version) => {
    try {
      await invoke<CoreStatus>("select_core_version", { kind, version })
      await get().loadLocal(kind, true)
    } catch (error) {
      set((state) => ({
        cores: {
          ...state.cores,
          [kind]: { ...state.cores[kind], error: String(error) },
        },
      }))
    }
  },

  removeVersion: async (kind, version) => {
    try {
      await invoke<CoreStatus>("remove_core_version", { kind, version })
      await get().loadLocal(kind, true)
    } catch (error) {
      set((state) => ({
        cores: {
          ...state.cores,
          [kind]: { ...state.cores[kind], error: String(error) },
        },
      }))
    }
  },
}))
