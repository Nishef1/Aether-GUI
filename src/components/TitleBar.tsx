import { getCurrentWindow } from "@tauri-apps/api/window";
import { Maximize2, Minus, X } from "lucide-react";
import { CloseToTrayToggle } from "@/components/CloseToTrayToggle";

const appWindow = getCurrentWindow();
const CONTROL =
  "grid h-full w-13 place-items-center text-muted-foreground outline-none transition-colors focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary";

export function TitleBar() {
  return (
    <header
      data-tauri-drag-region
      className="relative z-10 flex h-9 shrink-0 select-none items-center border-b border-white/[0.045] bg-background/55 backdrop-blur-sm"
      aria-label="Aether window controls"
    >
      <div className="pointer-events-none flex min-w-0 items-center gap-2 px-3">
        <span className="truncate text-[11px] font-semibold tracking-[0.14em] text-foreground uppercase">
          Aether
        </span>
        <span className="hidden text-[10px] text-muted-foreground sm:inline">Secure tunnel</span>
      </div>
      <div data-tauri-drag-region className="h-full min-w-4 flex-1" />
      <CloseToTrayToggle compact />
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
