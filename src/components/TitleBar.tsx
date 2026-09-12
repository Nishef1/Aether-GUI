import { getCurrentWindow } from "@tauri-apps/api/window";
import { Maximize2, Minus, X } from "lucide-react";

const appWindow = getCurrentWindow();
const CONTROL =
  "grid h-full w-13 place-items-center text-muted-foreground outline-none transition-colors focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary";

export function TitleBar() {
  return (
    // data-tauri-drag-region only fires when the mousedown target IS this
    // element, so the buttons stay clickable without any extra handling.
    <header
      data-tauri-drag-region
      className="relative z-10 flex h-9 shrink-0 select-none items-center justify-end"
      aria-label="Window controls"
    >
      <button
        type="button"
        aria-label="Minimize"
        className={`${CONTROL} hover:bg-surface-2 hover:text-foreground`}
        onClick={() => void appWindow.minimize()}
      >
        <Minus className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="Maximize or restore"
        className={`${CONTROL} hover:bg-surface-2 hover:text-foreground`}
        onClick={() => void appWindow.toggleMaximize()}
      >
        <Maximize2 className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="Close"
        className={`${CONTROL} hover:bg-destructive hover:text-white focus-visible:ring-destructive`}
        onClick={() => void appWindow.close()}
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </header>
  );
}
