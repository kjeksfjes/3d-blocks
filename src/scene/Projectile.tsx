import { RigidBody } from '@react-three/rapier'
import type { Vec3 } from '../templates/types'

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
  return (
    <RigidBody
      colliders="ball"
      position={position}
      linearVelocity={velocity}
      density={density}
      restitution={0.3}
      friction={0.6}
    >
      <mesh castShadow>
        <sphereGeometry args={[radius, 24, 24]} />
        <meshStandardMaterial color="#3a3a44" metalness={0.6} roughness={0.3} />
      </mesh>
    </RigidBody>
  )
}
