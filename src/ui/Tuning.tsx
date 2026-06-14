import { useEffect } from 'react'
import { useControls } from 'leva'
import { DEFAULT_TUNING, useStore, type ColorMode } from '../state/store'

/** leva panel -> store. Control keys match the Tuning fields so they spread in
 *  directly. Returns null; the panel itself is injected by leva. */
export function Tuning() {
  const setTuning = useStore((s) => s.setTuning)
  const setColor = useStore((s) => s.setColor)

  const color = useControls(
    'Color',
    {
      mode: { value: 'random', options: ['random', 'none', 'palette'] },
      variation: { value: 0.5, min: 0, max: 1, step: 0.05 },
    },
    { order: 0 },
  )

  const projectile = useControls(
    'Projectile',
    {
      shootSpeed: { value: DEFAULT_TUNING.shootSpeed, min: 5, max: 60, step: 1 },
      ballRadius: { value: DEFAULT_TUNING.ballRadius, min: 0.1, max: 1, step: 0.05 },
      ballDensity: { value: DEFAULT_TUNING.ballDensity, min: 1, max: 30, step: 1 },
    },
    { order: 1 },
  )

  const grab = useControls(
    'Grab',
    {
      throwScale: { value: DEFAULT_TUNING.throwScale, min: 0.5, max: 3, step: 0.1 },
      maxThrowSpeed: { value: DEFAULT_TUNING.maxThrowSpeed, min: 5, max: 60, step: 1 },
      heldAngularDamping: { value: DEFAULT_TUNING.heldAngularDamping, min: 0, max: 30, step: 1 },
    },
    { order: 2 },
  )

  useEffect(() => {
    setTuning({ ...projectile, ...grab })
  }, [projectile, grab, setTuning])

  useEffect(() => {
    setColor(color.mode as ColorMode, color.variation)
  }, [color, setColor])

  return null
}
