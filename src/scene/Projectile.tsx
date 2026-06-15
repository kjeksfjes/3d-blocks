import { useRef } from 'react'
import { RigidBody, type RapierRigidBody } from '@react-three/rapier'
import type { Vec3 } from '../templates/types'
import { useStore } from '../state/store'

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

  // In the reactive destruction modes (static / welded), report where/how fast we struck
  // so the scene can shatter or fracture the impacted region. No-op in loose mode.
  const onHit = () => {
    const store = useStore.getState()
    if (store.destructionMode === 'loose') return
    const b = ref.current
    if (!b) return
    const t = b.translation()
    // Use the launch velocity for the incoming direction — the body's live velocity may
    // already be the reflected (post-bounce) one off a fixed block.
    store.registerImpact([t.x, t.y, t.z], velocity)
  }

  return (
    <RigidBody
      ref={ref}
      colliders="ball"
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
