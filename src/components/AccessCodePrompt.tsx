import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { useConnectionStore } from "@/state/connectionStore";

export function AccessCodePrompt() {
  const status = useConnectionStore((state) => state.status);
  const accessCodeRequired = useConnectionStore((state) => state.accessCodeRequired);
  const clearAccessCodeRequirement = useConnectionStore(
    (state) => state.clearAccessCodeRequirement,
  );
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const visible = status.state === "AwaitingAccessCode" || accessCodeRequired;

  useEffect(() => {
    if (visible && !submitting) inputRef.current?.focus();
    if (!visible) {
      setCode("");
      setError(null);
    }
  }, [submitting, visible]);

  const submit = async () => {
    const normalized = code.trim();
    if (!normalized || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await invoke("submit_access_code", { code: normalized });
      setCode("");
      // Clear only the current prompt. If Aether rejects the code and asks
      // again in the same connection attempt, the next native/log event sets
      // the requirement again and the dialog reappears.
      clearAccessCodeRequirement();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSubmitting(false);
    }
  };

  if (!visible) return null;

  return (
    <div
      className="fixed inset-x-4 z-50 mx-auto max-w-sm rounded-2xl border border-white/10 bg-surface-1/95 p-4 shadow-2xl backdrop-blur-xl"
      style={{ bottom: "max(1rem, env(safe-area-inset-bottom, 0px))" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="access-code-title"
    >
      <p id="access-code-title" className="text-sm font-semibold text-foreground">
        Cloudflare Access code
      </p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Enter the one-time code sent to your Zero Trust email. It goes directly to Aether and is never logged or saved.
      </p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <input
          ref={inputRef}
          value={code}
          inputMode="numeric"
          enterKeyHint="done"
          autoComplete="one-time-code"
          maxLength={512}
          disabled={submitting}
          onChange={(event) => setCode(event.target.value)}
          className="min-h-12 min-w-0 flex-1 rounded-xl bg-black/20 px-3 font-mono text-base text-foreground ring-1 ring-white/10 outline-none focus:ring-primary disabled:opacity-60"
          aria-label="Cloudflare Access code"
        />
        <Button
          type="submit"
          className="min-h-12 px-4"
          disabled={!code.trim() || submitting}
        >
          {submitting ? "Verifying…" : "Verify"}
        </Button>
      </form>
      {error && (
        <p className="mt-2 text-xs leading-relaxed text-status-error" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}
