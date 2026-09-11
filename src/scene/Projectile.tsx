import { useEffect, useRef } from 'react'
import { RigidBody, type RapierRigidBody } from '@react-three/rapier'
import type { Vec3 } from '../templates/types'
import { useStore } from '../state/store'
import { audioManager } from '../audio/AudioManager'

/** A heavy ball fired into the scene. Radius/density are captured at fire time
 *  (from tuning) so each shot keeps the parameters it was launched with. */
export function Projectile({
  position,
  velocity,
  radius,
  density,
}: {
  position: Vec3
  velocity: Vec3
  radius: number
  density: number
}) {
  const ref = useRef<RapierRigidBody>(null)

  // Tag this body so ImpactSampler gives it the metal timbre (bricks default to
  // the stone knock). Handle is stable for the body's life.
  useEffect(() => {
    const h = ref.current?.handle
    if (h === undefined) return
    audioManager.addProjectile(h)
    return () => audioManager.removeProjectile(h)
  }, [])

  // In the reactive destruction modes (static / welded), report where/how fast we struck
  // so the scene can shatter or fracture the impacted region. No-op in loose mode.
  // (Impact AUDIO is handled globally by ImpactSampler via velocity deltas.)
  const onHit = () => {
    const b = ref.current
    if (!b) return
    const store = useStore.getState()
    if (store.destructionMode === 'loose') return
    const t = b.translation()
    // Use the launch velocity for the incoming direction — the body's live velocity may
    // already be the reflected (post-bounce) one off a fixed block.
    store.registerImpact([t.x, t.y, t.z], velocity)
  }

  return (
    <RigidBody
      ref={ref}
      colliders="ball"
      // Continuous collision detection: physics uses a vary timestep (= frame time),
      // so a fast ball would otherwise jump past the 0.5m-thick wall between two
      // discrete checks and never collide — very visible on a phone, whose longer
      // frames mean longer steps. Only the ball pays the CCD cost, never the bricks.
      ccd
      position={position}
      linearVelocity={velocity}
      density={density}
      restitution={0.3}
      friction={0.6}
      onCollisionEnter={onHit}
    >
      <mesh castShadow>
        <sphereGeometry args={[radius, 24, 24]} />
        <meshStandardMaterial color="#3a3a44" metalness={0.6} roughness={0.3} />
      </mesh>
    </RigidBody>
  )
}
