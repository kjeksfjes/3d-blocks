import { useLayoutEffect, useMemo, useRef } from 'react'
import { InstancedRigidBodies, type InstancedRigidBodyProps } from '@react-three/rapier'
import { Color, type InstancedMesh } from 'three'
import type { InstanceSpec, TemplateSpec, Vec3 } from '../templates/types'
import { useStore } from '../state/store'

interface SizeGroup {
  size: Vec3
  specs: InstanceSpec[]
}

/** Bucket instances by box size so each distinct size becomes one instanced mesh. */
function groupBySize(specs: InstanceSpec[]): SizeGroup[] {
  const map = new Map<string, SizeGroup>()
  for (const s of specs) {
    const key = s.size.join('x')
    let group = map.get(key)
    if (!group) {
      group = { size: s.size, specs: [] }
      map.set(key, group)
    }
    group.specs.push(s)
  }
  return [...map.values()]
}

function InstanceGroup({
  group,
  friction,
  restitution,
}: {
  group: SizeGroup
  friction: number
  restitution: number
}) {
  const meshRef = useRef<InstancedMesh>(null)

  const instances = useMemo<InstancedRigidBodyProps[]>(
    () => group.specs.map((s, i) => ({ key: i, position: s.position, rotation: s.rotation })),
    [group],
  )

  // Per-instance colours (the instanced mesh shares one material).
  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const color = new Color()
    group.specs.forEach((s, i) => mesh.setColorAt(i, color.set(s.color ?? '#d98c5f')))
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [group])

  return (
    <InstancedRigidBodies
      instances={instances}
      colliders="cuboid"
      friction={friction}
      restitution={restitution}
    >
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, group.specs.length]}
        castShadow
        receiveShadow
        frustumCulled={false}
      >
        <boxGeometry args={group.size} />
        <meshStandardMaterial roughness={0.75} metalness={0.05} />
      </instancedMesh>
    </InstancedRigidBodies>
  )
}

/**
 * Renders a template as one instanced mesh per distinct block size, each backed
 * by one rigid body per block. Remount with a new `key` to reset. Friction /
 * restitution are read once at mount, so tuning changes apply on rebuild.
 */
export function Structure({ template }: { template: TemplateSpec }) {
  const tuning = useRef(useStore.getState().tuning).current
  const groups = useMemo(() => groupBySize(template.build()), [template])

  return (
    <>
      {groups.map((group, i) => (
        <InstanceGroup
          key={i}
          group={group}
          friction={tuning.blockFriction}
          restitution={tuning.blockRestitution}
        />
      ))}
    </>
  )
}
