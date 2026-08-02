import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { useConnectionStore } from "@/state/connectionStore";

export function AccessCodePrompt() {
  const status = useConnectionStore((state) => state.status);
  const logs = useConnectionStore((state) => state.logs);
  const attemptId = useConnectionStore((state) => state.attemptId);
  const [dismissedAttempt, setDismissedAttempt] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const nativePrompt = status.state === "AwaitingAccessCode";
  const desktopPrompt = logs.some((entry) =>
    entry.line.includes("[gui] Zero Trust access code required"),
  );
  const visible = (nativePrompt || desktopPrompt) && dismissedAttempt !== attemptId;

  useEffect(() => {
    if (visible) inputRef.current?.focus();
  }, [visible]);

  const submit = async () => {
    const normalized = code.trim();
    if (!normalized) return;
    setError(null);
    try {
      await invoke("submit_access_code", { code: normalized });
      setCode("");
      setDismissedAttempt(attemptId);
    } catch (cause) {
      setError(String(cause));
    }
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-sm rounded-xl border border-white/10 bg-surface-1/95 p-4 shadow-2xl backdrop-blur-xl">
      <p className="text-sm font-medium text-foreground">Cloudflare Access code</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Enter the one-time code sent to your Zero Trust email. The code is sent directly to Aether and is not logged or saved.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          ref={inputRef}
          value={code}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={512}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
          className="h-9 min-w-0 flex-1 rounded-md bg-black/20 px-3 font-mono text-sm text-foreground ring-1 ring-white/10 outline-none focus:ring-primary"
          aria-label="Cloudflare Access code"
        />
        <Button type="button" onClick={() => void submit()} disabled={!code.trim()}>
          Verify
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-status-error">{error}</p>}
    </div>
  );
}
