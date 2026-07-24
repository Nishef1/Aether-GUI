import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Switch } from "@/components/ui/switch"

export function CloseToTrayToggle() {
  const [enabled, setEnabled] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void invoke<boolean>("get_close_to_tray")
      .then((value) => {
        if (!cancelled) setEnabled(value)
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(`Could not load tray preference: ${String(loadError)}`)
        }
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const updatePreference = async (next: boolean) => {
    const previous = enabled
    setEnabled(next)
    setSaving(true)
    setError(null)

    try {
      await invoke<void>("set_close_to_tray", { enabled: next })
    } catch (saveError) {
      setEnabled(previous)
      setError(`Could not save tray preference: ${String(saveError)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="w-full max-w-sm px-1 py-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          Minimize to system tray
        </span>
        <Switch
          checked={enabled}
          disabled={!loaded || saving}
          onCheckedChange={(next) => void updatePreference(next)}
          aria-label="Minimize to system tray instead of closing"
          aria-describedby={error ? "close-to-tray-error" : undefined}
        />
      </div>
      {error && (
        <p
          id="close-to-tray-error"
          className="mt-1 text-[10px] text-destructive"
          role="status"
        >
          {error}
        </p>
      )}
    </div>
  )
}
