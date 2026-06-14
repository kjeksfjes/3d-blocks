import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  InstancedRigidBodies,
  type InstancedRigidBodyProps,
  type RapierRigidBody,
} from '@react-three/rapier'
import { Color, Euler, Quaternion, type InstancedMesh } from 'three'
import type { InstanceSpec, SpawnMode, TemplateSpec, Vec3 } from '../templates/types'
import { useStore } from '../state/store'

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

function InstanceGroup({
  group,
  mode,
  cacheKey,
  friction,
  restitution,
}: {
  group: SizeGroup
  mode: SpawnMode
  cacheKey: string
  friction: number
  restitution: number
}) {
  const meshRef = useRef<InstancedMesh>(null)
  const bodiesRef = useRef<(RapierRigidBody | null)[]>(null)
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
      // Restore normal (zero) damping so this first instance behaves like later spawns.
      for (const b of bodies) {
        b!.setLinearDamping(0)
        b!.setAngularDamping(0)
      }
      capturedRef.current = true
    }
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
 * Renders a template as one instanced mesh per distinct block size, each backed by
 * one rigid body per block. Spawn stabilisation follows the template's `spawn` mode
 * ('pinned' = freeze as built; 'settled' = bake a rested equilibrium once and reuse).
 * Remount with a new `key` to reset.
 */
export function Structure({ template }: { template: TemplateSpec }) {
  const tuning = useRef(useStore.getState().tuning).current
  const groups = useMemo(() => groupBySize(template.build()), [template])
  const mode = template.spawn ?? 'pinned'

  return (
    <>
      {groups.map((group, i) => (
        <InstanceGroup
          key={i}
          group={group}
          mode={mode}
          cacheKey={`${template.id}:${group.size.join('x')}`}
          friction={tuning.blockFriction}
          restitution={tuning.blockRestitution}
        />
      ))}
    </>
  )
}
