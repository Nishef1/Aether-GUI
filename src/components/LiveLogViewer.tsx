import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Trash2 } from "lucide-react";
import { useConnectionStore } from "@/state/connectionStore";

function compactConsecutiveLogs(lines: string[]): string {
  const compacted: string[] = [];
  let previous = "";
  let repeats = 0;

  for (const line of lines) {
    if (line === previous && compacted.length > 0) {
      repeats += 1;
      compacted[compacted.length - 1] = `${line}  ×${repeats}`;
      continue;
    }

    previous = line;
    repeats = 1;
    compacted.push(line);
  }

  return compacted.join("\n");
}

export function LiveLogViewer() {
  const logs = useConnectionStore((state) => state.logs);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const output = useMemo(
    () => compactConsecutiveLogs(logs.map((log) => log.line)),
    [logs]
  );

  useEffect(() => {
    if (!autoScroll || !viewportRef.current) return;

    const viewport = viewportRef.current;
    const frame = requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [output, autoScroll]);

  useEffect(
    () => () => {
      if (copyResetRef.current !== null) clearTimeout(copyResetRef.current);
    },
    []
  );

  const copyLogs = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      if (copyResetRef.current !== null) clearTimeout(copyResetRef.current);
      copyResetRef.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard access is supplementary; the visible logs remain available.
    }
  };

  const clearLogs = () => {
    useConnectionStore.setState({ logs: [] });
    setAutoScroll(true);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] text-muted-foreground">
          {logs.length > 0 ? `${logs.length} recent entries` : "No recent entries"}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!output}
            onClick={() => void copyLogs()}
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[10px] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            aria-label="Copy live logs"
          >
            {copied ? (
              <Check className="size-3" aria-hidden="true" />
            ) : (
              <Copy className="size-3" aria-hidden="true" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            disabled={logs.length === 0}
            onClick={clearLogs}
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[10px] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            aria-label="Clear live logs"
          >
            <Trash2 className="size-3" aria-hidden="true" />
            Clear
          </button>
        </div>
      </div>

      <div
        ref={viewportRef}
        onScroll={(event) => {
          const viewport = event.currentTarget;
          const nextAutoScroll =
            viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 24;
          setAutoScroll((current) =>
            current === nextAutoScroll ? current : nextAutoScroll
          );
        }}
        className="h-56 overflow-y-auto rounded-lg bg-black/20 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground ring-1 ring-white/10"
      >
        {output ? (
          <pre className="m-0 whitespace-pre-wrap break-words font-inherit text-inherit">
            {output}
          </pre>
        ) : (
          <p className="text-status-idle">No output yet.</p>
        )}
      </div>
    </div>
  );
}
