import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  InstancedRigidBodies,
  useRapier,
  type InstancedRigidBodyProps,
  type RapierRigidBody,
} from '@react-three/rapier'
import { Color, Euler, Quaternion, type InstancedMesh } from 'three'
import type { InstanceSpec, SpawnMode, TemplateSpec, Vec3 } from '../templates/types'
import { templateLivePhysics, useStore, type LivePhysics } from '../state/store'

const ZERO = { x: 0, y: 0, z: 0 }

// Per-block colour variation around each material's base tone. Maxima are scaled by
// the 0–1 `colorVariation` setting; the random jitter is deterministic (hashed from
// the block index) so it looks random but is stable across resets.
const MAX_HUE_JITTER = 0.024
const MAX_SAT_JITTER = 0.07
const MAX_LIGHT_JITTER = 0.17
const MAX_PALETTE_STEP = 0.08 // discrete lightness step for the 3-tone 'palette' look
const hash = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const SETTLE_GUARD_FRAMES = 10 // frames to hold a structure pinned asleep on spawn
const BAKE_MIN_FRAMES = 8 // don't capture a bake before the structure has had a chance to move
const BAKE_MAX_FRAMES = 600 // hard cap (~10s) so a never-quite-sleeping body still gets baked
// Heavy damping during the one-time bake so structures ease into equilibrium gently
// instead of wobbling themselves over (which would bake a collapsed state).
const BAKE_LINEAR_DAMPING = 4
const BAKE_ANGULAR_DAMPING = 8

interface Transform {
  px: number
  py: number
  pz: number
  qx: number
  qy: number
  qz: number
  qw: number
}

// Per-session cache of settled transforms for 'settled' templates, keyed by template
// + block size, so each settles only once and later spawns reuse the equilibrium.
const bakeCache = new Map<string, Transform[]>()

interface SizeGroup {
  size: Vec3
  specs: InstanceSpec[]
}

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

function pin(b: RapierRigidBody, t: Transform) {
  b.setTranslation({ x: t.px, y: t.py, z: t.pz }, false)
  b.setRotation({ x: t.qx, y: t.qy, z: t.qz, w: t.qw }, false)
  b.setLinvel(ZERO, false)
  b.setAngvel(ZERO, false)
  b.sleep()
}

type BodiesRef = MutableRefObject<(RapierRigidBody | null)[] | null>

function InstanceGroup({
  group,
  mode,
  cacheKey,
  live,
  bodiesRef,
}: {
  group: SizeGroup
  mode: SpawnMode
  cacheKey: string
  live: LivePhysics
  bodiesRef: BodiesRef
}) {
  const meshRef = useRef<InstancedMesh>(null)
  const guardRef = useRef(0)
  const bakedRef = useRef<Transform[] | null>(mode === 'settled' ? bakeCache.get(cacheKey) ?? null : null)
  const dampedRef = useRef(false)
  const capturedRef = useRef(false)
  const settleRef = useRef(0)

  const instances = useMemo<InstancedRigidBodyProps[]>(
    () => group.specs.map((s, i) => ({ key: i, position: s.position, rotation: s.rotation })),
    [group],
  )

  // Built transforms, used to pin 'pinned' structures exactly as authored.
  const built = useMemo<Transform[]>(() => {
    const e = new Euler()
    const q = new Quaternion()
    return group.specs.map((s) => {
      const r = s.rotation ?? [0, 0, 0]
      q.setFromEuler(e.set(r[0], r[1], r[2]))
      return { px: s.position[0], py: s.position[1], pz: s.position[2], qx: q.x, qy: q.y, qz: q.z, qw: q.w }
    })
  }, [group])

  const colorMode = useStore((s) => s.colorMode)
  const colorVariation = useStore((s) => s.colorVariation)

  // Per-instance colours (the instanced mesh shares one material). Re-runs live when
  // the colour mode/variation changes.
  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const color = new Color()
    const hsl = { h: 0, s: 0, l: 0 }
    group.specs.forEach((s, i) => {
      color.set(s.color ?? '#d98c5f')
      if (colorMode === 'random') {
        color.getHSL(hsl)
        color.setHSL(
          hsl.h + (hash(i + 0.3) - 0.5) * MAX_HUE_JITTER * colorVariation,
          clamp01(hsl.s + (hash(i + 1.7) - 0.5) * MAX_SAT_JITTER * colorVariation),
          clamp01(hsl.l + (hash(i + 2.9) - 0.5) * MAX_LIGHT_JITTER * colorVariation),
        )
      } else if (colorMode === 'palette') {
        color.getHSL(hsl)
        color.setHSL(hsl.h, hsl.s, clamp01(hsl.l + ((i % 3) - 1) * MAX_PALETTE_STEP * colorVariation))
      }
      mesh.setColorAt(i, color)
    })
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [group, colorMode, colorVariation])

  // Apply live physics tweaks to existing bodies/colliders so values can be tuned by
  // feel without a remount. Friction/restitution live on the colliders; damping on the
  // body. Bodies are woken so the change takes effect on the resting structure.
  useEffect(() => {
    const bodies = bodiesRef.current
    if (!bodies) return
    for (const b of bodies) {
      if (!b) continue
      b.setLinearDamping(live.linearDamping)
      b.setAngularDamping(live.angularDamping)
      for (let i = 0; i < b.numColliders(); i++) {
        const c = b.collider(i)
        c.setFriction(live.friction)
        c.setRestitution(live.restitution)
      }
      b.wakeUp()
    }
  }, [live])

  useFrame(() => {
    const bodies = bodiesRef.current
    if (!bodies || bodies.length < group.specs.length || bodies.some((b) => b == null)) return

    // 'pinned': freeze at built positions for a few frames, then leave asleep.
    if (mode === 'pinned') {
      if (guardRef.current >= SETTLE_GUARD_FRAMES) return
      for (let i = 0; i < bodies.length; i++) pin(bodies[i]!, built[i])
      guardRef.current++
      return
    }

    // 'settled': reuse the baked equilibrium if we have it...
    const baked = bakedRef.current
    if (baked) {
      if (guardRef.current >= SETTLE_GUARD_FRAMES) return
      for (let i = 0; i < bodies.length; i++) pin(bodies[i]!, baked[i])
      guardRef.current++
      return
    }

    // ...otherwise this is the first spawn: damped gentle settle, then capture it.
    if (capturedRef.current) return
    if (!dampedRef.current) {
      for (const b of bodies) {
        b!.setLinearDamping(BAKE_LINEAR_DAMPING)
        b!.setAngularDamping(BAKE_ANGULAR_DAMPING)
      }
      dampedRef.current = true
    }
    settleRef.current++
    const settled = settleRef.current >= BAKE_MIN_FRAMES && bodies.every((b) => b!.isSleeping())
    if (settled || settleRef.current >= BAKE_MAX_FRAMES) {
      bakeCache.set(
        cacheKey,
        bodies.map((b) => {
          const t = b!.translation()
          const r = b!.rotation()
          return { px: t.x, py: t.y, pz: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w }
        }),
      )
      // Restore the body's resting damping so this first instance behaves like later
      // spawns (which get these values from the RigidBody props at creation).
      for (const b of bodies) {
        b!.setLinearDamping(live.linearDamping)
        b!.setAngularDamping(live.angularDamping)
      }
      capturedRef.current = true
    }
  })

  return (
    <InstancedRigidBodies
      ref={bodiesRef}
      instances={instances}
      colliders="cuboid"
      friction={live.friction}
      restitution={live.restitution}
      linearDamping={live.linearDamping}
      angularDamping={live.angularDamping}
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
 * Renders a template as one instanced mesh per distinct block size, each backed by
 * one rigid body per block. Spawn stabilisation follows the template's `spawn` mode
 * ('pinned' = freeze as built; 'settled' = bake a rested equilibrium once and reuse).
 * Remount with a new `key` to reset.
 */
/** Build-order index -> the (group, in-group offset) it lands at after groupBySize. */
interface BodyLocation {
  groupIndex: number
  indexInGroup: number
}

export function Structure({
  template,
  toggles,
}: {
  template: TemplateSpec
  toggles?: Record<string, boolean>
}) {
  const specs = useMemo(() => template.build(toggles), [template, toggles])
  const groups = useMemo(() => groupBySize(specs), [specs])
  const mode = template.spawn ?? 'pinned'

  // Live block physics for this scene (remembered session value or the template's
  // defaults), used both as the bodies' initial params and applied live by InstanceGroup.
  const live = useStore((s) => s.livePhysicsByScene[template.id]) ?? templateLivePhysics(template)

  // One body-array ref per group, owned here so welds can reach across groups.
  const groupRefs = useMemo<BodiesRef[]>(
    () => groups.map(() => ({ current: null })),
    [groups],
  )

  // Translate the template's build-order weld pairs into (group, offset) locations.
  const weldPairs = useMemo<[BodyLocation, BodyLocation][]>(() => {
    const raw = template.welds?.(toggles) ?? []
    if (raw.length === 0) return []
    const sizeKeyToGroup = new Map(groups.map((g, gi) => [g.size.join('x'), gi]))
    const counters = new Map<number, number>()
    const locations: BodyLocation[] = specs.map((s) => {
      const groupIndex = sizeKeyToGroup.get(s.size.join('x'))!
      const indexInGroup = counters.get(groupIndex) ?? 0
      counters.set(groupIndex, indexInGroup + 1)
      return { groupIndex, indexInGroup }
    })
    return raw.map(([a, b]) => [locations[a], locations[b]])
  }, [template, toggles, specs, groups])

  return (
    <>
      {groups.map((group, i) => (
        <InstanceGroup
          key={i}
          group={group}
          mode={mode}
          cacheKey={`${template.id}:${group.size.join('x')}`}
          live={live}
          bodiesRef={groupRefs[i]}
        />
      ))}
      {weldPairs.length > 0 && <Welds groupRefs={groupRefs} pairs={weldPairs} />}
    </>
  )
}

const IDENTITY_ROT = { x: 0, y: 0, z: 0, w: 1 }

/**
 * Creates fixed joints welding the given body pairs at their current relative pose,
 * once all referenced bodies exist. Assumes the blocks are axis-aligned at spawn, so
 * the joint frames are identity and only the centre offset is needed. The joints are
 * removed on unmount; remounting (reset) rebuilds them.
 */
function Welds({
  groupRefs,
  pairs,
}: {
  groupRefs: BodiesRef[]
  pairs: [BodyLocation, BodyLocation][]
}) {
  const { world, rapier } = useRapier()
  const doneRef = useRef(false)
  const jointsRef = useRef<ReturnType<typeof world.createImpulseJoint>[]>([])

  const bodyAt = (loc: BodyLocation) => groupRefs[loc.groupIndex]?.current?.[loc.indexInGroup] ?? null

  useFrame(() => {
    if (doneRef.current) return
    if (!pairs.every(([a, b]) => bodyAt(a) && bodyAt(b))) return
    for (const [a, b] of pairs) {
      const b1 = bodyAt(a)!
      const b2 = bodyAt(b)!
      const p1 = b1.translation()
      const p2 = b2.translation()
      const data = rapier.JointData.fixed(
        { x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z },
        IDENTITY_ROT,
        { x: 0, y: 0, z: 0 },
        IDENTITY_ROT,
      )
      // wakeUp=false: keep the structure asleep on spawn.
      jointsRef.current.push(world.createImpulseJoint(data, b1, b2, false))
    }
    doneRef.current = true
  })

  useEffect(
    () => () => {
      for (const j of jointsRef.current) world.removeImpulseJoint(j, false)
      jointsRef.current = []
    },
    [world],
  )

  return null
}
