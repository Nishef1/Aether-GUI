import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { CoreKind, CoreRelease, CoreStatus } from "@/types/core";

interface CoreEntry {
  releases: CoreRelease[];
  status: CoreStatus | null;
  loading: boolean;
  error: string | null;
}

interface CoreStore {
  cores: Record<CoreKind, CoreEntry>;
  refresh: (kind: CoreKind) => Promise<void>;
  installAndUse: (kind: CoreKind, version: string) => Promise<void>;
  selectVersion: (kind: CoreKind, version: string) => Promise<void>;
  removeVersion: (kind: CoreKind, version: string) => Promise<void>;
}

const emptyEntry = (): CoreEntry => ({
  releases: [],
  status: null,
  loading: false,
  error: null,
});

export const useCoreStore = create<CoreStore>((set, get) => ({
  cores: {
    aether: emptyEntry(),
    singbox: emptyEntry(),
  },

  refresh: async (kind) => {
    set((state) => ({
      cores: {
        ...state.cores,
        [kind]: { ...state.cores[kind], loading: true, error: null },
      },
    }));
    try {
      const [releases, status] = await Promise.all([
        invoke<CoreRelease[]>("list_core_versions", { kind }),
        invoke<CoreStatus>("get_core_status", { kind }),
      ]);
      set((state) => ({
        cores: {
          ...state.cores,
          [kind]: { releases, status, loading: false, error: null },
        },
      }));
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
      }));
    }
  },

  installAndUse: async (kind, version) => {
    set((state) => ({
      cores: {
        ...state.cores,
        [kind]: { ...state.cores[kind], loading: true, error: null },
      },
    }));
    try {
      await invoke<CoreStatus>("install_core_version", { kind, version });
      await get().refresh(kind);
    } catch (error) {
      set((state) => ({
        cores: {
          ...state.cores,
          [kind]: { ...state.cores[kind], loading: false, error: String(error) },
        },
      }));
    }
  },

  selectVersion: async (kind, version) => {
    try {
      await invoke<CoreStatus>("select_core_version", { kind, version });
      await get().refresh(kind);
    } catch (error) {
      set((state) => ({
        cores: {
          ...state.cores,
          [kind]: { ...state.cores[kind], error: String(error) },
        },
      }));
    }
  },

  removeVersion: async (kind, version) => {
    try {
      await invoke<CoreStatus>("remove_core_version", { kind, version });
      await get().refresh(kind);
    } catch (error) {
      set((state) => ({
        cores: {
          ...state.cores,
          [kind]: { ...state.cores[kind], error: String(error) },
        },
      }));
    }
  },
}));
