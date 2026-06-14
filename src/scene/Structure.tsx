import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  InstancedRigidBodies,
  type InstancedRigidBodyProps,
  type RapierRigidBody,
} from '@react-three/rapier'
import { Color, Euler, Quaternion, type InstancedMesh } from 'three'
import type { InstanceSpec, TemplateSpec, Vec3 } from '../templates/types'
import { useStore } from '../state/store'

const ZERO = { x: 0, y: 0, z: 0 }
// Frames to pin a freshly-spawned structure asleep so it can't settle on spawn/reset.
const SETTLE_GUARD_FRAMES = 10

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
  const bodiesRef = useRef<(RapierRigidBody | null)[]>(null)
  const settleGuardRef = useRef(0)

  const instances = useMemo<InstancedRigidBodyProps[]>(
    () => group.specs.map((s, i) => ({ key: i, position: s.position, rotation: s.rotation })),
    [group],
  )

  // Built transforms (position + quaternion) we pin bricks to during spawn.
  const targets = useMemo(() => {
    const e = new Euler()
    const q = new Quaternion()
    return group.specs.map((s) => {
      const r = s.rotation ?? [0, 0, 0]
      q.setFromEuler(e.set(r[0], r[1], r[2]))
      return { x: s.position[0], y: s.position[1], z: s.position[2], qx: q.x, qy: q.y, qz: q.z, qw: q.w }
    })
  }, [group])

  // Per-instance colours (the instanced mesh shares one material).
  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const color = new Color()
    group.specs.forEach((s, i) => mesh.setColorAt(i, color.set(s.color ?? '#d98c5f')))
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [group])

  // Spawn asleep: the bricks are placed in a valid resting stack, so the settle is
  // unwanted. For the first several frames once the bodies exist, we pin each body
  // back to its exact built transform with zero velocity and put it to sleep. This
  // is robust to any timing (cold load can step a freshly-created body with a huge
  // dt before we catch it — snapping the transform undoes that). After the guard
  // window they're left asleep until a collision wakes them.
  useFrame(() => {
    if (settleGuardRef.current >= SETTLE_GUARD_FRAMES) return
    const bodies = bodiesRef.current
    if (!bodies || bodies.length < instances.length || bodies.some((b) => b == null)) return
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!
      const t = targets[i]
      b.setTranslation({ x: t.x, y: t.y, z: t.z }, false)
      b.setRotation({ x: t.qx, y: t.qy, z: t.qz, w: t.qw }, false)
      b.setLinvel(ZERO, false)
      b.setAngvel(ZERO, false)
      b.sleep()
    }
    settleGuardRef.current++
  })

  return (
    <InstancedRigidBodies
      ref={bodiesRef}
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
