import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { cancelAutomaticConnect } from "@/lib/autoConnect";
import { useConnectionStore } from "@/state/connectionStore";
import { useExitPolicyStore } from "@/state/exitPolicyStore";

function AccessCodeDialog() {
  const disconnect = useConnectionStore((state) => state.disconnect);
  const clearAccessCodeRequirement = useConnectionStore(
    (state) => state.clearAccessCodeRequirement,
  );
  const cancelAutomation = useExitPolicyStore((state) => state.cancelAutomation);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const cancel = async () => {
    cancelAutomaticConnect();
    cancelAutomation();
    clearAccessCodeRequirement();
    await disconnect();
  };

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
      // the requirement again and a fresh dialog instance is mounted.
      clearAccessCodeRequirement();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) void cancel();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom,0px))] z-50 mx-auto max-w-sm rounded-[1.35rem] bg-surface-1/98 p-4 shadow-2xl ring-1 ring-white/12 outline-none sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:p-5"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          onInteractOutside={(event) => event.preventDefault()}
          aria-describedby="access-code-description"
        >
          <DialogPrimitive.Title
            id="access-code-title"
            className="text-sm font-semibold text-foreground"
          >
            Cloudflare Access code
          </DialogPrimitive.Title>
          <DialogPrimitive.Description
            id="access-code-description"
            className="mt-1 text-xs leading-relaxed text-muted-foreground"
          >
            Enter the one-time code sent to your Zero Trust email. It goes directly to Aether and
            is never logged or saved.
          </DialogPrimitive.Description>

          <form
            className="mt-4 grid gap-3"
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
              className="min-h-12 w-full rounded-xl bg-black/20 px-3 font-mono text-base text-foreground ring-1 ring-white/10 outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
              aria-label="Cloudflare Access code"
            />
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-12"
                onClick={() => void cancel()}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="min-h-12"
                disabled={!code.trim() || submitting}
              >
                {submitting ? "Verifying…" : "Verify"}
              </Button>
            </div>
          </form>

          {error && (
            <p
              className="mt-3 rounded-xl bg-status-error/6 px-3 py-2 text-xs leading-relaxed text-status-error ring-1 ring-status-error/15"
              role="alert"
            >
              {error}
            </p>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function AccessCodePrompt() {
  const status = useConnectionStore((state) => state.status);
  const accessCodeRequired = useConnectionStore((state) => state.accessCodeRequired);
  const visible = status.state === "AwaitingAccessCode" || accessCodeRequired;

  return visible ? <AccessCodeDialog /> : null;
}
