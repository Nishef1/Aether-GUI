import { useEffect, useMemo, useRef, useState } from "react";
import { useConnectionStore } from "@/state/connectionStore";

export function LiveLogViewer() {
  const logs = useConnectionStore((state) => state.logs);
  const [autoScroll, setAutoScroll] = useState(true);
  const viewportRef = useRef<HTMLDivElement>(null);
  const output = useMemo(() => logs.map((log) => log.line).join("\n"), [logs]);

  useEffect(() => {
    if (!autoScroll || !viewportRef.current) return;

    const viewport = viewportRef.current;
    const frame = requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [output, autoScroll]);

  return (
    <div
      ref={viewportRef}
      onScroll={(event) => {
        const viewport = event.currentTarget;
        const nextAutoScroll =
          viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 24;
        setAutoScroll((current) => (current === nextAutoScroll ? current : nextAutoScroll));
      }}
      className="h-56 overflow-y-auto rounded-lg bg-black/20 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground ring-1 ring-white/10"
    >
      {output ? (
        <pre className="m-0 whitespace-pre-wrap break-words font-inherit text-inherit">{output}</pre>
      ) : (
        <p className="text-status-idle">No output yet.</p>
      )}
    </div>
  );
}
