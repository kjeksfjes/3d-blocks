import { useEffect, useRef } from 'react'

/** Registry of per-panel reset handlers, so the single "Reset to defaults" button at the
 *  bottom of the leva panel can reset every scene-dependent folder at once. Keyed by
 *  panel id; handlers unregister on unmount, so a switched-away scene can't be reset. */
const handlers = new Map<string, () => void>()

/** Registers this panel's reset handler for the lifetime of the component. */
export function useResetDefaults(id: string, reset: () => void) {
  const ref = useRef(reset)
  ref.current = reset
  useEffect(() => {
    const run = () => ref.current()
    handlers.set(id, run)
    return () => {
      if (handlers.get(id) === run) handlers.delete(id)
    }
  }, [id])
}

export function resetAllDefaults() {
  for (const reset of handlers.values()) reset()
}
