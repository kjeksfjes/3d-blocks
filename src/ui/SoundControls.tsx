import { useEffect } from 'react'
import { useControls } from 'leva'
import { audioManager } from '../audio/AudioManager'

/** leva panel -> audio engine. The engine owns its own volume/mute state; this
 *  just mirrors the controls into it. Returns null; the panel is injected by leva. */
export function SoundControls() {
  const { volume, muted } = useControls(
    'Sound',
    {
      volume: { value: 0.7, min: 0, max: 1, step: 0.05 },
      muted: { value: false },
    },
    { order: 4 },
  )

  useEffect(() => {
    audioManager.setVolume(volume)
  }, [volume])

  useEffect(() => {
    audioManager.setMuted(muted)
  }, [muted])

  return null
}
