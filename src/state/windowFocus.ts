import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { useSyncExternalStore } from "react"

/**
 * Single source of truth for "is the host window focused". Primary feed:
 * the Rust-side GetForegroundWindow watcher (`app://focused`, see
 * src-tauri/src/focus.rs) — every webview-visible signal proved unreliable
 * on Windows (tao focus events fire inconsistently, isFocused()
 * false-negatives while the WebView2 child holds Win32 focus, and
 * document.hasFocus() stays true even minimized; all verified live).
 * Tauri's own focus events stay wired as a faster secondary signal; the
 * Rust watcher corrects them within a second either way. Every looping
 * animation and foreground-only poll gates on this value.
 */
let focused = true
const listeners = new Set<() => void>()

function setFocused(next: boolean) {
  if (next === focused) return
  focused = next
  listeners.forEach((listener) => listener())
}

const DEBUG_EVENT_LIMIT = 32
const debugEvents: Array<{ t: number; focused: boolean; src: string }> = []

function recordFocus(next: boolean, source: string) {
  if (import.meta.env.DEV) {
    debugEvents.push({ t: Date.now(), focused: next, src: source })
    if (debugEvents.length > DEBUG_EVENT_LIMIT) {
      debugEvents.splice(0, debugEvents.length - DEBUG_EVENT_LIMIT)
    }
  }
  setFocused(next)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): boolean {
  return focused
}

try {
  void listen<boolean>("app://focused", (event) =>
    recordFocus(event.payload, "rust")
  )
  void getCurrentWindow().onFocusChanged(({ payload }) =>
    recordFocus(payload, "tauri")
  )

  if (import.meta.env.DEV) {
    ;(window as unknown as { __focus?: object }).__focus = {
      state: getSnapshot,
      events: () => [...debugEvents],
    }
  }
} catch {
  // Not inside Tauri (plain-browser dev) — stays "focused".
}

export function useWindowFocused(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot)
}
