import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Switch } from "@/components/ui/switch";

export function CloseToTrayToggle({ compact = false }: { compact?: boolean }) {
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void invoke<boolean>("get_close_to_tray")
      .then((value) => {
        if (!active) return;
        setEnabled(value);
        setError(null);
      })
      .catch(() => {
        if (active) setError("Could not load the tray preference.");
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const update = async (next: boolean) => {
    if (saving) return;
    const previous = enabled;
    setEnabled(next);
    setSaving(true);
    setError(null);
    try {
      await invoke("set_close_to_tray", { enabled: next });
    } catch {
      setEnabled(previous);
      setError("Could not save the tray preference. Your previous setting was restored.");
    } finally {
      setSaving(false);
    }
  };

  if (compact) {
    return (
      <div
        className="flex h-full shrink-0 items-center gap-1.5 border-l border-white/8 px-2 text-[10px] text-muted-foreground"
        title={error ?? "Keep Aether running when the window is closed"}
      >
        <span className="select-none">Tray</span>
        <Switch
          className="scale-75"
          checked={enabled}
          disabled={!loaded || saving}
          onCheckedChange={(on) => void update(on)}
          aria-label="Minimize to system tray instead of closing"
        />
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="flex min-h-12 w-full max-w-sm items-center justify-between px-1 py-2 text-xs text-muted-foreground">
        <span>Minimize to system tray</span>
        <span role="status">Loading…</span>
      </div>
    );
  }

  return (
    <div className="grid w-full max-w-sm gap-1 px-1 py-2">
      <div className="flex min-h-12 items-center justify-between gap-3">
        <div>
          <span className="block text-xs text-muted-foreground">Minimize to system tray</span>
          <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
            Keep Aether running when the window is closed.
          </span>
        </div>
        <Switch
          checked={enabled}
          disabled={saving}
          onCheckedChange={(on) => void update(on)}
          aria-label="Minimize to system tray instead of closing"
        />
      </div>
      {error && (
        <p className="text-[10px] leading-4 text-status-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
