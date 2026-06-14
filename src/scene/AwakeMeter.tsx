import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useRapier } from '@react-three/rapier'
import { useStore } from '../state/store'

const SAMPLE_INTERVAL = 0.2 // seconds between samples (avoids per-frame store churn)

/** Samples the number of awake (non-sleeping) rigid bodies into the store, so the
 *  DOM readout can show whether the structure sleeps after settling. */
export function AwakeMeter() {
  const { world } = useRapier()
  const setAwakeBodies = useStore((s) => s.setAwakeBodies)
  const acc = useRef(0)

  useFrame((_, dt) => {
    acc.current += dt
    if (acc.current < SAMPLE_INTERVAL) return
    acc.current = 0
    let n = 0
    world.forEachActiveRigidBody(() => n++)
    setAwakeBodies(n)
  })

  return null
}
