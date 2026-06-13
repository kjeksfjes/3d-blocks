import { useEffect } from 'react'
import { useControls } from 'leva'
import { DEFAULT_TUNING, useStore } from '../state/store'

/** leva panel -> store. Control keys match the Tuning fields so they spread in
 *  directly. Returns null; the panel itself is injected by leva. */
export function Tuning() {
  const setTuning = useStore((s) => s.setTuning)

  const projectile = useControls('Projectile', {
    shootSpeed: { value: DEFAULT_TUNING.shootSpeed, min: 5, max: 60, step: 1 },
    ballRadius: { value: DEFAULT_TUNING.ballRadius, min: 0.1, max: 1, step: 0.05 },
    ballDensity: { value: DEFAULT_TUNING.ballDensity, min: 1, max: 30, step: 1 },
  })

  const grab = useControls('Grab', {
    throwScale: { value: DEFAULT_TUNING.throwScale, min: 0.5, max: 3, step: 0.1 },
    maxThrowSpeed: { value: DEFAULT_TUNING.maxThrowSpeed, min: 5, max: 60, step: 1 },
    heldAngularDamping: { value: DEFAULT_TUNING.heldAngularDamping, min: 0, max: 30, step: 1 },
  })

  const blocks = useControls('Blocks (applied on Reset)', {
    blockFriction: { value: DEFAULT_TUNING.blockFriction, min: 0, max: 2, step: 0.05 },
    blockRestitution: { value: DEFAULT_TUNING.blockRestitution, min: 0, max: 1, step: 0.05 },
  })

  useEffect(() => {
    setTuning({ ...projectile, ...grab, ...blocks })
  }, [projectile, grab, blocks, setTuning])

  return null
}
