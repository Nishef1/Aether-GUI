import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ChevronDown, Info, Settings2 } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Glass } from "@samasante/liquid-glass";
import { ProtocolSelect } from "@/components/ProtocolSelect";
import { ScanModeToggle } from "@/components/ScanModeToggle";
import { IpVersionToggle } from "@/components/IpVersionToggle";
import { useConnectionStore } from "@/state/connectionStore";

function FieldRow({
  label,
  tooltip,
  children,
}: {
  label: string;
  tooltip?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {tooltip && (
          <Tooltip>
            <TooltipTrigger aria-label={`About ${label}`}>
              <Info size={12} />
            </TooltipTrigger>
            <TooltipContent>{tooltip}</TooltipContent>
          </Tooltip>
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * Collapsed by default — this *is* the auto-mode default: press Connect,
 * done. Everything configurable (the 3 real options Aether's TUI supports —
 * see aether/prompts.rs, nothing else exists to expose) plus the raw log
 * stream live behind this one disclosure.
 */
export function AdvancedPanel() {
  const logs = useConnectionStore((s) => s.logs);
  const [open, setOpen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const viewportRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (autoScroll && viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  return (
    <motion.div
      layout="position"
      transition={
        reduceMotion
          ? { duration: 0 }
          : { type: "spring", stiffness: 380, damping: 34, mass: 0.7 }
      }
      className="w-full max-w-sm"
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary rounded-md">
          <Settings2 size={14} />
          Advanced
          <ChevronDown
            size={14}
            className="transition-transform duration-200 data-[state=open]:rotate-180"
            data-state={open ? "open" : "closed"}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-1 data-[state=open]:duration-300 data-[state=open]:[animation-timing-function:cubic-bezier(0.16,1,0.3,1)] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-bottom-2 data-[state=closed]:duration-150">
          <div className="flex flex-col gap-4 pb-2">
          <FieldRow
            label="Protocol"
            tooltip="MASQUE disguises traffic as normal HTTPS — best against strict censorship. WireGuard is lighter and faster. gool nests two WireGuard tunnels for extra security at a speed cost."
          >
            <ProtocolSelect />
          </FieldRow>
          <FieldRow label="Scan Mode">
            <ScanModeToggle />
          </FieldRow>
          <FieldRow
            label="IP Version"
            tooltip="Which address families to search for working routes. IPv4 is the safest default on most networks."
          >
            <IpVersionToggle />
          </FieldRow>

          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[10px] tracking-wide text-muted-foreground uppercase">
              Logs
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <Glass
            className="block w-full overflow-hidden rounded-md"
            radius={6}
            optics={{ curvature: 0.16, depth: 0.72, frost: 0.6, glow: 0.12, sheen: 0.45, strength: 0.05 }}
          >
            <div
              ref={viewportRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
              }}
              className="max-h-64 overflow-y-auto bg-black/20 p-2 font-mono text-xs text-muted-foreground"
            >
              {logs.length === 0 ? (
                <p className="text-status-idle">No output yet.</p>
              ) : (
                logs.map((l, i) => <p key={i}>{l.line}</p>)
              )}
            </div>
          </Glass>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </motion.div>
  );
}
