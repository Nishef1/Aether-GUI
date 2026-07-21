import { getCurrentWindow } from "@tauri-apps/api/window";
import { Maximize2, Minus, Settings, X } from "lucide-react";

const appWindow = getCurrentWindow();

export function TitleBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <header
      data-tauri-drag-region
      className="relative z-40 flex h-9 shrink-0 select-none items-center justify-end"
    >
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
  );
}
