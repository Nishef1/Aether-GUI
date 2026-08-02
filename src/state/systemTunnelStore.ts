import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { SystemTunnelSelection } from "@/types/connection";

interface SystemTunnelState {
  selection: SystemTunnelSelection;
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  setSelection: (selection: SystemTunnelSelection) => Promise<void>;
}

export const useSystemTunnelStore = create<SystemTunnelState>((set) => ({
  selection: "off",
  loaded: false,
  error: null,
  load: async () => {
    try {
      const selection = await invoke<SystemTunnelSelection>("get_system_tunnel");
      set({ selection, loaded: true, error: null });
    } catch (error) {
      set({ loaded: true, error: String(error) });
    }
  },
  setSelection: async (selection) => {
    try {
      await invoke("set_system_tunnel", { selection });
      set({ selection, error: null });
    } catch (error) {
      set({ error: String(error) });
    }
  },
}));
