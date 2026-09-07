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

const DESKTOP_TUNNEL_DEFAULT_KEY = "aether-gui:desktop-tunnel-default:v1";

const normalizeSelection = (selection: SystemTunnelSelection): SystemTunnelSelection =>
  isAndroid ? "native" : selection;

export const useSystemTunnelStore = create<SystemTunnelState>((set) => ({
  selection: isAndroid ? "native" : "off",
  loaded: false,
  error: null,
  load: async () => {
    try {
      const storedSelection = await invoke<SystemTunnelSelection>("get_system_tunnel");
      let selection = normalizeSelection(storedSelection);

      if (isAndroid) {
        if (selection !== storedSelection) {
          await invoke("set_system_tunnel", { selection });
        }
      } else if (
        selection === "off" &&
        window.localStorage.getItem(DESKTOP_TUNNEL_DEFAULT_KEY) !== "applied"
      ) {
        // Full-device protection is the product default. This migration runs
        // once; after it, an explicit user choice to disable the TUN is kept.
        selection = "singbox";
        await invoke("set_system_tunnel", { selection });
        window.localStorage.setItem(DESKTOP_TUNNEL_DEFAULT_KEY, "applied");
      }

      set({ selection, loaded: true, error: null });
    } catch (error) {
      set({ loaded: false, error: String(error) });
    }
  },
  setSelection: async (selection) => {
    const enforcedSelection = normalizeSelection(selection);
    try {
      await invoke("set_system_tunnel", { selection: enforcedSelection });
      if (!isAndroid) {
        window.localStorage.setItem(DESKTOP_TUNNEL_DEFAULT_KEY, "applied");
      }
      set({ selection: enforcedSelection, loaded: true, error: null });
    } catch (error) {
      set({ error: String(error) });
    }
  },
}));
