import { useRef } from 'react'
import { RigidBody } from '@react-three/rapier'
import type { BlockSpec } from '../templates/types'
import { useStore } from '../state/store'

/** One dynamic rigid-body block built from a BlockSpec. Friction/restitution are
 *  read once at mount, so tuning changes take effect when the structure rebuilds. */
export function Block({ spec }: { spec: BlockSpec }) {
  const { blockFriction, blockRestitution } = useRef(useStore.getState().tuning).current

  return (
    <RigidBody
      colliders="cuboid"
      position={spec.position}
      rotation={spec.rotation}
      restitution={blockRestitution}
      friction={blockFriction}
    >
      <mesh castShadow receiveShadow>
        <boxGeometry args={spec.size} />
        <meshStandardMaterial color={spec.color ?? '#d98c5f'} roughness={0.75} metalness={0.05} />
      </mesh>
    </RigidBody>
  )
}
