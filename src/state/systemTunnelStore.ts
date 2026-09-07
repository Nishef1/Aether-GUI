import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { isAndroid } from "@/lib/platform";
import type { SystemTunnelSelection } from "@/types/connection";

interface SystemTunnelState {
  selection: SystemTunnelSelection;
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  setSelection: (selection: SystemTunnelSelection) => Promise<void>;
}

const normalizeSelection = (selection: SystemTunnelSelection): SystemTunnelSelection =>
  isAndroid ? "native" : selection;

let inFlightLoad: Promise<void> | null = null;

export const useSystemTunnelStore = create<SystemTunnelState>((set) => ({
  selection: isAndroid ? "native" : "singbox",
  loaded: false,
  error: null,
  load: async () => {
    if (inFlightLoad) return inFlightLoad;
    inFlightLoad = (async () => {
      try {
        const storedSelection = await invoke<SystemTunnelSelection>("get_system_tunnel");
        const selection = normalizeSelection(storedSelection);
        if (isAndroid && selection !== storedSelection) {
          await invoke("set_system_tunnel", { selection });
        }
        set({ selection, loaded: true, error: null });
      } catch (error) {
        set({ loaded: false, error: String(error) });
      } finally {
        inFlightLoad = null;
      }
    })();
    return inFlightLoad;
  },
  setSelection: async (selection) => {
    const enforcedSelection = normalizeSelection(selection);
    try {
      await invoke("set_system_tunnel", { selection: enforcedSelection });
      set({ selection: enforcedSelection, loaded: true, error: null });
    } catch (error) {
      set({ error: String(error) });
    }
  },
}));
