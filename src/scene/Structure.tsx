import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  InstancedRigidBodies,
  useRapier,
  type InstancedRigidBodyProps,
  type RapierRigidBody,
} from '@react-three/rapier'
import { Color, Euler, Quaternion, Vector3, type InstancedMesh } from 'three'
import type { InstanceSpec, SpawnMode, TemplateSpec, Vec3 } from '../templates/types'
import { templateLivePhysics, useStore, type DestructionMode, type LivePhysics } from '../state/store'

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
// Max a brick may drift from its built position for the settle to be cached. A gentle
// settle stays well under 1; a crumble (from an early hit) scatters bricks many units, so
// 2 cleanly separates them without risking a false reject of a legitimate settle.
const BAKE_MAX_DISP = 2.0

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
  staticMode,
  bodiesRef,
}: {
  group: SizeGroup
  mode: SpawnMode
  cacheKey: string
  live: LivePhysics
  staticMode: boolean
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
    // Static-until-hit: bodies are fixed and authored in place, so there's nothing to
    // pin, settle or bake — they hold until Impacts converts the struck ones to dynamic.
    if (staticMode) return

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
      // Only cache if the structure settled close to as-built. If it was knocked/crumbled
      // before this first bake finished, caching that disturbed layout would poison every
      // later reset; skip caching and let a fresh spawn re-bake cleanly.
      let maxDispSq = 0
      for (let i = 0; i < bodies.length; i++) {
        const t = bodies[i]!.translation()
        const dx = t.x - built[i].px
        const dy = t.y - built[i].py
        const dz = t.z - built[i].pz
        const d = dx * dx + dy * dy + dz * dz
        if (d > maxDispSq) maxDispSq = d
      }
      if (maxDispSq <= BAKE_MAX_DISP * BAKE_MAX_DISP) {
        bakeCache.set(
          cacheKey,
          bodies.map((b) => {
            const t = b!.translation()
            const r = b!.rotation()
            return { px: t.x, py: t.y, pz: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w }
          }),
        )
      }
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
      type={staticMode ? 'fixed' : 'dynamic'}
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
  mode = 'loose',
}: {
  template: TemplateSpec
  toggles?: Record<string, boolean>
  mode?: DestructionMode
}) {
  const staticMode = mode === 'static'
  const welded = mode === 'welded'
  const specs = useMemo(() => template.build(toggles), [template, toggles])
  const groups = useMemo(() => groupBySize(specs), [specs])
  const spawnMode = template.spawn ?? 'pinned'

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
          mode={spawnMode}
          cacheKey={`${template.id}:${group.size.join('x')}`}
          live={live}
          staticMode={staticMode}
          bodiesRef={groupRefs[i]}
        />
      ))}
      {/* Welds anchor the dynamic-collapse mode; static-until-hit is already rigid. */}
      {!staticMode && weldPairs.length > 0 && <Welds groupRefs={groupRefs} pairs={weldPairs} />}
      {staticMode && <Impacts groupRefs={groupRefs} groupSizes={groups.map((g) => g.size)} />}
      {welded && specs.length <= WELD_MAX_BRICKS && (
        <Bonds groupRefs={groupRefs} groupSizes={groups.map((g) => g.size)} />
      )}
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
// How far a pillar weld may drift from its rest offset before it tears. Rapier exposes
// no joint-impulse readback, but a fixed joint under load is visibly violated by the
// solver, so this drift stands in for the force the weld is carrying. Tuned by feel:
// bricks hold through ordinary knocks and let go when a collapse really leans on them.
const WELD_BREAK_STRAIN = 0.05

function Welds({
  groupRefs,
  pairs,
}: {
  groupRefs: BodiesRef[]
  pairs: [BodyLocation, BodyLocation][]
}) {
  const { world, rapier } = useRapier()
  type Joint = ReturnType<typeof world.createImpulseJoint>
  // `rest` is body2's origin expressed in body1's local frame at spawn. Comparing it
  // with the live offset each frame gives how far the solver is failing to satisfy the
  // joint, which stands in for the force the weld is carrying (Rapier exposes no joint
  // impulse readback here).
  type Weld = { joint: Joint; b1: RapierRigidBody; b2: RapierRigidBody; rest: Vector3; cut: boolean }

  const weldsRef = useRef<Weld[] | null>(null)

  // Scratch, reused per frame so the strain check allocates nothing.
  const q = useRef(new Quaternion())
  const off = useRef(new Vector3())

  const bodyAt = (loc: BodyLocation) => groupRefs[loc.groupIndex]?.current?.[loc.indexInGroup] ?? null

  useFrame(() => {
    // Create the welds once every body exists.
    if (!weldsRef.current) {
      if (!pairs.every(([a, b]) => bodyAt(a) && bodyAt(b))) return
      const list: Weld[] = []
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
        list.push({
          // wakeUp=false: keep the structure asleep on spawn.
          joint: world.createImpulseJoint(data, b1, b2, false),
          b1,
          b2,
          // Bodies spawn axis-aligned, so the local rest offset is the world delta.
          rest: new Vector3(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z),
          cut: false,
        })
      }
      weldsRef.current = list
      return
    }

    // Tear any weld strained past the limit: it is carrying more than it can hold.
    for (const w of weldsRef.current) {
      if (w.cut) continue
      const p1 = w.b1.translation()
      const p2 = w.b2.translation()
      const r1 = w.b1.rotation()
      q.current.set(r1.x, r1.y, r1.z, r1.w).invert()
      off.current.set(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z).applyQuaternion(q.current)
      if (off.current.distanceTo(w.rest) <= WELD_BREAK_STRAIN) continue
      world.removeImpulseJoint(w.joint, true)
      w.cut = true
    }
  })

  useEffect(
    () => () => {
      for (const w of weldsRef.current ?? []) if (!w.cut) world.removeImpulseJoint(w.joint, false)
      weldsRef.current = null
    },
    [world],
  )

  return null
}

// Static-until-hit shatter tuning. Feel values — tune in-app, not derived from anything.
const IMPACT_RADIUS = 2.5 // world units around the hit point that turn dynamic
const SHATTER_GAIN = 0.45 // fraction of the ball's speed imparted at the impact centre
const SHATTER_LIFT = 1.5 // extra upward pop at the centre, easing to 0 at the radius

// Support-graph + falling-chunk tuning.
const GROUND_EPS = 0.08 // a brick whose underside is within this of y=0 counts as grounded
const TOUCH_EPS = 0.06 // AABB slack when deciding two bricks are neighbours
const SUPPORT_CELL = 1.5 // spatial-hash cell size for neighbour search
// Components larger than this crumble instead of welding. This is the perf knob: a welded
// chunk is one rigid body per brick + one joint per brick, so a big chunk is the heaviest
// case. 1000 lets a full Wall (~900) tip as one piece; lower it if big collapses hitch.
const MAX_WELD_CHUNK = 1000
const BREAK_MIN_PEAK = 2.5 // a chunk must have been moving this fast to be allowed to break
const BREAK_DROP_RATIO = 0.4 // break when speed falls to this fraction of its peak (a hard landing)

interface FixedBrick {
  body: RapierRigidBody
  x: number
  y: number
  z: number
  hx: number
  hy: number
  hz: number
}

const aabbTouch = (a: FixedBrick, b: FixedBrick) =>
  Math.abs(a.x - b.x) <= a.hx + b.hx + TOUCH_EPS &&
  Math.abs(a.y - b.y) <= a.hy + b.hy + TOUCH_EPS &&
  Math.abs(a.z - b.z) <= a.hz + b.hz + TOUCH_EPS

/** Neighbour lists for the bricks, via a multi-cell spatial hash (so tall/large bricks
 *  like pillars, which span many cells, are matched correctly). */
function buildAdjacency(bricks: FixedBrick[]): number[][] {
  const cells = new Map<string, number[]>()
  const lo = (v: number, h: number) => Math.floor((v - h - TOUCH_EPS) / SUPPORT_CELL)
  const hi = (v: number, h: number) => Math.floor((v + h + TOUCH_EPS) / SUPPORT_CELL)
  bricks.forEach((b, i) => {
    for (let cx = lo(b.x, b.hx); cx <= hi(b.x, b.hx); cx++)
      for (let cy = lo(b.y, b.hy); cy <= hi(b.y, b.hy); cy++)
        for (let cz = lo(b.z, b.hz); cz <= hi(b.z, b.hz); cz++) {
          const k = `${cx},${cy},${cz}`
          const list = cells.get(k)
          if (list) list.push(i)
          else cells.set(k, [i])
        }
  })
  const adj: number[][] = bricks.map(() => [])
  bricks.forEach((b, i) => {
    const seen = new Set<number>()
    for (let cx = lo(b.x, b.hx); cx <= hi(b.x, b.hx); cx++)
      for (let cy = lo(b.y, b.hy); cy <= hi(b.y, b.hy); cy++)
        for (let cz = lo(b.z, b.hz); cz <= hi(b.z, b.hz); cz++) {
          for (const j of cells.get(`${cx},${cy},${cz}`) ?? []) {
            if (j <= i || seen.has(j)) continue
            seen.add(j)
            if (aabbTouch(b, bricks[j])) {
              adj[i].push(j)
              adj[j].push(i)
            }
          }
        }
  })
  return adj
}

/** A component to release, with a spanning tree (each brick's weld parent, local index;
 *  -1 for the root) so it can be welded with distributed joints rather than a star. */
interface ReleaseComp {
  bricks: FixedBrick[]
  parent: number[]
}

/**
 * Connected components that should let go, each as a spanning tree:
 *  - FLOATING — no brick touches the ground (fully severed), or
 *  - UNBALANCED — grounded, but the component's centre of mass no longer sits over the
 *    footprint of its ground-contact bricks, so it must topple.
 * Grounded, balanced components are left out (they stay fixed). The COM is volume-weighted
 * over all the component's bricks; the footprint is the x/z bounding box of its ground
 * contacts (a reasonable proxy for the support polygon for these axis-aligned stacks).
 */
function releasableComponents(bricks: FixedBrick[]): ReleaseComp[] {
  const n = bricks.length
  const adj = buildAdjacency(bricks)
  const seen = new Array<boolean>(n).fill(false)
  const out: ReleaseComp[] = []

  for (let s = 0; s < n; s++) {
    if (seen[s]) continue
    // BFS the component, recording each brick's parent (local index) for the weld tree.
    const comp: FixedBrick[] = [bricks[s]]
    const parent: number[] = [-1]
    const localOf = new Map<number, number>([[s, 0]])
    const order = [s]
    seen[s] = true
    for (let head = 0; head < order.length; head++) {
      const k = order[head]
      for (const j of adj[k]) {
        if (seen[j]) continue
        seen[j] = true
        parent.push(localOf.get(k)!)
        localOf.set(j, comp.length)
        comp.push(bricks[j])
        order.push(j)
      }
    }

    // Classify: ground contact, footprint, centre of mass.
    let grounded = false
    let xmin = Infinity
    let xmax = -Infinity
    let zmin = Infinity
    let zmax = -Infinity
    let mSum = 0
    let cx = 0
    let cz = 0
    for (const b of comp) {
      const m = b.hx * b.hy * b.hz // ∝ volume; uniform density, so the constant cancels
      mSum += m
      cx += m * b.x
      cz += m * b.z
      if (b.y - b.hy <= GROUND_EPS) {
        grounded = true
        xmin = Math.min(xmin, b.x - b.hx)
        xmax = Math.max(xmax, b.x + b.hx)
        zmin = Math.min(zmin, b.z - b.hz)
        zmax = Math.max(zmax, b.z + b.hz)
      }
    }
    if (!grounded) {
      out.push({ bricks: comp, parent })
      continue
    }
    const comX = cx / mSum
    const comZ = cz / mSum
    if (comX < xmin || comX > xmax || comZ < zmin || comZ > zmax) out.push({ bricks: comp, parent })
  }
  return out
}

/** Up to `max` bodies spread evenly across the list, for cheap chunk-speed sampling. */
function sampleBodies(bodies: RapierRigidBody[], max = 8): RapierRigidBody[] {
  const count = Math.min(max, bodies.length)
  const step = bodies.length / count
  const out: RapierRigidBody[] = []
  for (let i = 0; i < count; i++) out.push(bodies[Math.floor(i * step)])
  return out
}

/**
 * Static-until-hit destruction. On each new projectile impact:
 *  1. converts every still-fixed block within IMPACT_RADIUS to dynamic and flings it
 *     (the localized shatter), then
 *  2. re-evaluates the still-fixed structure: any connected region that is either severed
 *     from the ground OR grounded-but-unbalanced (centre of mass off its footprint) is
 *     released as a RIGID CHUNK — welded along a spanning tree — so it falls or TOPPLES as
 *     one piece, then BREAKS into loose bricks on a hard landing (a sharp speed drop).
 * Components above MAX_WELD_CHUNK crumble immediately instead of welding (perf guard).
 * Resolves the floating-bricks limitation noted in blk-246.12.
 */
function Impacts({ groupRefs, groupSizes }: { groupRefs: BodiesRef[]; groupSizes: Vec3[] }) {
  const { world, rapier } = useRapier()
  type Joint = ReturnType<typeof world.createImpulseJoint>
  type Chunk = { bodies: RapierRigidBody[]; sample: RapierRigidBody[]; joints: Joint[]; peak: number; broken: boolean }

  const lastImpact = useStore((s) => s.lastImpact)
  // Ignore any impact that predates this mount (e.g. a leftover from before a reset).
  const processedRef = useRef(useStore.getState().lastImpact?.id ?? 0)
  const chunksRef = useRef<Chunk[]>([])

  useEffect(() => {
    if (!lastImpact || lastImpact.id <= processedRef.current) return
    processedRef.current = lastImpact.id

    // 1. Localized shatter around the impact.
    const [ix, iy, iz] = lastImpact.position
    const [vx, vy, vz] = lastImpact.velocity
    const speed = Math.hypot(vx, vy, vz) || 1
    const bdx = vx / speed
    const bdy = vy / speed
    const bdz = vz / speed
    for (const ref of groupRefs) {
      const bodies = ref.current
      if (!bodies) continue
      for (const b of bodies) {
        if (!b || b.bodyType() !== rapier.RigidBodyType.Fixed) continue
        const t = b.translation()
        const dx = t.x - ix
        const dy = t.y - iy
        const dz = t.z - iz
        const dist = Math.hypot(dx, dy, dz)
        if (dist > IMPACT_RADIUS) continue
        const falloff = 1 - dist / IMPACT_RADIUS
        let nx = bdx
        let ny = bdy
        let nz = bdz
        if (dist > 1e-3) {
          nx = dx / dist + bdx * 0.5
          ny = dy / dist + bdy * 0.5
          nz = dz / dist + bdz * 0.5
          const n = Math.hypot(nx, ny, nz) || 1
          nx /= n
          ny /= n
          nz /= n
        }
        b.setBodyType(rapier.RigidBodyType.Dynamic, true)
        const sp = speed * SHATTER_GAIN * falloff
        b.setLinvel({ x: nx * sp, y: ny * sp + SHATTER_LIFT * falloff, z: nz * sp }, true)
        b.setAngvel(
          {
            x: (hash(t.x) - 0.5) * 8 * falloff,
            y: (hash(t.y + 1.3) - 0.5) * 8 * falloff,
            z: (hash(t.z + 2.6) - 0.5) * 8 * falloff,
          },
          true,
        )
        b.wakeUp()
      }
    }

    // 2. Re-evaluate support/balance and release any region that should fall or topple.
    const bricks: FixedBrick[] = []
    groupRefs.forEach((ref, gi) => {
      const bodies = ref.current
      if (!bodies) return
      const [sx, sy, sz] = groupSizes[gi]
      for (const b of bodies) {
        if (!b || b.bodyType() !== rapier.RigidBodyType.Fixed) continue
        const t = b.translation()
        bricks.push({ body: b, x: t.x, y: t.y, z: t.z, hx: sx / 2, hy: sy / 2, hz: sz / 2 })
      }
    })
    if (bricks.length === 0) return

    for (const comp of releasableComponents(bricks)) {
      const list = comp.bricks
      // Single strays or oversized regions just crumble (loose dynamic bricks).
      if (list.length <= 1 || list.length > MAX_WELD_CHUNK) {
        for (const br of list) {
          br.body.setBodyType(rapier.RigidBodyType.Dynamic, true)
          br.body.wakeUp()
        }
        continue
      }
      // Weld into one rigid chunk along the spanning tree (each brick to its parent),
      // locking the current relative pose so it falls/topples as a single piece.
      for (const br of list) br.body.setBodyType(rapier.RigidBodyType.Dynamic, true)
      const joints: Joint[] = []
      for (let i = 0; i < list.length; i++) {
        const p = comp.parent[i]
        if (p < 0) continue
        const child = list[i].body
        const par = list[p].body
        const pt = par.translation()
        const pq = par.rotation()
        const ct = child.translation()
        const cq = child.rotation()
        const qpInv = new Quaternion(pq.x, pq.y, pq.z, pq.w).invert()
        const frame1 = qpInv.clone().multiply(new Quaternion(cq.x, cq.y, cq.z, cq.w))
        const off = new Vector3(ct.x - pt.x, ct.y - pt.y, ct.z - pt.z).applyQuaternion(qpInv)
        const data = rapier.JointData.fixed(
          { x: off.x, y: off.y, z: off.z },
          { x: frame1.x, y: frame1.y, z: frame1.z, w: frame1.w },
          { x: 0, y: 0, z: 0 },
          IDENTITY_ROT,
        )
        joints.push(world.createImpulseJoint(data, par, child, true))
      }
      const bodies = list.map((c) => c.body)
      chunksRef.current.push({ bodies, sample: sampleBodies(bodies), joints, peak: 0, broken: false })
    }
  }, [lastImpact, groupRefs, groupSizes, world, rapier])

  // Break a falling chunk into loose bricks when it lands hard (a sharp drop from its
  // peak speed). Dissolving the joints leaves the bricks as ordinary dynamic bodies.
  useFrame(() => {
    const chunks = chunksRef.current
    if (chunks.length === 0) return
    for (const ch of chunks) {
      if (ch.broken) continue
      // Max speed across a sample — a tipping chunk pivots, so its fastest point (the top)
      // is what registers the landing, not any single anchor near the pivot.
      let speed = 0
      for (const b of ch.sample) {
        const v = b.linvel()
        const s = Math.hypot(v.x, v.y, v.z)
        if (s > speed) speed = s
      }
      if (speed > ch.peak) ch.peak = speed
      if (ch.peak >= BREAK_MIN_PEAK && speed <= ch.peak * BREAK_DROP_RATIO) {
        for (const j of ch.joints) world.removeImpulseJoint(j, true)
        ch.broken = true
        for (const b of ch.bodies) {
          const t = b.translation()
          b.setAngvel(
            { x: (hash(t.x) - 0.5) * 6, y: (hash(t.y + 1.3) - 0.5) * 6, z: (hash(t.z + 2.6) - 0.5) * 6 },
            true,
          )
          b.wakeUp()
        }
      }
    }
    if (chunks.length > 32) chunksRef.current = chunks.filter((c) => !c.broken)
  })

  useEffect(
    () => () => {
      for (const ch of chunksRef.current) if (!ch.broken) for (const j of ch.joints) world.removeImpulseJoint(j, false)
      chunksRef.current = []
    },
    [world],
  )

  return null
}

// "Welded" mode tuning.
const BOND_BREAK_RADIUS = 2.0 // bonds (and bricks) within this of a hit are broken / flung
// Only weld structures up to this brick count. Welding suits solid, stackable shapes
// (Wall, Jenga). Large thin/curved single walls (the Cylinder, the Castle's round towers)
// can't take rigid bonds — they over-constrain and explode — and elastic/loose bonds just
// shake or sag, so above this size welded mode simply leaves the structure unbonded (it
// behaves like loose mode). See blk-246.12.
const WELD_MAX_BRICKS = 1500
// Landing shatter: track each welded brick's PEAK speed; once it has been moving at least
// LAND_MIN_SPEED and then drops to LAND_DROP_RATIO of that peak, it has hit something, so it
// sheds its bonds. Peak-drop (not per-frame Δspeed) is what catches a damped, rigidly-bonded
// landing where the deceleration is spread over several frames. Feel values: raise
// LAND_MIN_SPEED / lower the ratio if it fractures too eagerly mid-tumble.
const LAND_MIN_SPEED = 2
const LAND_DROP_RATIO = 0.5

/**
 * "Welded" destruction. Bonds every brick to its neighbours with fixed joints once on
 * spawn, so the structure behaves like a coherent solid — a hit no longer ripples through
 * and crumbles the whole thing, because the far, still-bonded regions stay a rigid sleeping
 * island. On each impact only the bonds NEAR the hit are cut (and those bricks flung), so it
 * fractures locally; undermine one side and the bonded remainder topples as a whole — then
 * shatters on landing, because a brick that decelerates hard (an impact) sheds its bonds.
 */
function Bonds({ groupRefs, groupSizes }: { groupRefs: BodiesRef[]; groupSizes: Vec3[] }) {
  const { world, rapier } = useRapier()
  type Joint = ReturnType<typeof world.createImpulseJoint>
  // a, b index into the flat body list, so a brick can shed its own bonds on a hard hit.
  type Bond = { joint: Joint; a: number; b: number; mx: number; my: number; mz: number; cut: boolean }

  const lastImpact = useStore((s) => s.lastImpact)
  const processedRef = useRef(useStore.getState().lastImpact?.id ?? 0)
  const bondsRef = useRef<Bond[] | null>(null)
  const bodiesRef = useRef<RapierRigidBody[]>([])
  const bondsByBrickRef = useRef<Bond[][]>([])
  const peakSpeedRef = useRef<number[]>([])

  // Create the bonds once the structure has come fully to REST (every body asleep), so
  // each joint is locked at the true resting pose. Welding mid-settle (e.g. while a
  // 'settled' template like the cylinder eases into equilibrium) would lock non-rest poses
  // and then explode as the settle keeps moving the bricks.
  useFrame(() => {
    if (bondsRef.current) return
    const bricks: FixedBrick[] = []
    const bodies: RapierRigidBody[] = []
    let ready = true
    for (let gi = 0; gi < groupRefs.length; gi++) {
      const list = groupRefs[gi].current
      if (!list || list.some((b) => b == null || !b.isSleeping())) {
        ready = false
        break
      }
      const [sx, sy, sz] = groupSizes[gi]
      for (const b of list) {
        const t = b!.translation()
        bricks.push({ body: b!, x: t.x, y: t.y, z: t.z, hx: sx / 2, hy: sy / 2, hz: sz / 2 })
        bodies.push(b!)
      }
    }
    if (!ready) return

    const adj = buildAdjacency(bricks)
    const bonds: Bond[] = []
    for (let i = 0; i < bricks.length; i++) {
      for (const j of adj[i]) {
        if (j <= i) continue // each unordered pair once
        const par = bricks[i].body
        const child = bricks[j].body
        const pt = par.translation()
        const pq = par.rotation()
        const ct = child.translation()
        const cq = child.rotation()
        const qpInv = new Quaternion(pq.x, pq.y, pq.z, pq.w).invert()
        const frame1 = qpInv.clone().multiply(new Quaternion(cq.x, cq.y, cq.z, cq.w))
        const off = new Vector3(ct.x - pt.x, ct.y - pt.y, ct.z - pt.z).applyQuaternion(qpInv)
        const data = rapier.JointData.fixed(
          { x: off.x, y: off.y, z: off.z },
          { x: frame1.x, y: frame1.y, z: frame1.z, w: frame1.w },
          { x: 0, y: 0, z: 0 },
          IDENTITY_ROT,
        )
        bonds.push({
          joint: world.createImpulseJoint(data, par, child, false),
          a: i,
          b: j,
          mx: (pt.x + ct.x) / 2,
          my: (pt.y + ct.y) / 2,
          mz: (pt.z + ct.z) / 2,
          cut: false,
        })
      }
    }
    const byBrick: Bond[][] = bricks.map(() => [])
    for (const bond of bonds) {
      byBrick[bond.a].push(bond)
      byBrick[bond.b].push(bond)
    }
    bondsRef.current = bonds
    bondsByBrickRef.current = byBrick
    bodiesRef.current = bodies
    peakSpeedRef.current = new Array(bodies.length).fill(0)
  })

  // On each impact: cut the bonds near the hit (local fracture) and fling the loosened
  // bricks. Bonds farther away hold, so the rest of the structure stays coherent.
  useEffect(() => {
    if (!lastImpact || lastImpact.id <= processedRef.current) return
    processedRef.current = lastImpact.id
    const bonds = bondsRef.current
    if (!bonds) return

    const [ix, iy, iz] = lastImpact.position
    const [vx, vy, vz] = lastImpact.velocity
    const speed = Math.hypot(vx, vy, vz) || 1
    const bdx = vx / speed
    const bdy = vy / speed
    const bdz = vz / speed
    const r2 = BOND_BREAK_RADIUS * BOND_BREAK_RADIUS

    for (const bond of bonds) {
      if (bond.cut) continue
      const dx = bond.mx - ix
      const dy = bond.my - iy
      const dz = bond.mz - iz
      if (dx * dx + dy * dy + dz * dz > r2) continue
      world.removeImpulseJoint(bond.joint, true)
      bond.cut = true
    }

    for (const b of bodiesRef.current) {
      const t = b.translation()
      const dx = t.x - ix
      const dy = t.y - iy
      const dz = t.z - iz
      const dist = Math.hypot(dx, dy, dz)
      if (dist > BOND_BREAK_RADIUS) continue
      const falloff = 1 - dist / BOND_BREAK_RADIUS
      let nx = bdx
      let ny = bdy
      let nz = bdz
      if (dist > 1e-3) {
        nx = dx / dist + bdx * 0.5
        ny = dy / dist + bdy * 0.5
        nz = dz / dist + bdz * 0.5
        const n = Math.hypot(nx, ny, nz) || 1
        nx /= n
        ny /= n
        nz /= n
      }
      const sp = speed * SHATTER_GAIN * falloff
      b.setLinvel({ x: nx * sp, y: ny * sp + SHATTER_LIFT * falloff, z: nz * sp }, true)
      b.wakeUp()
    }
  }, [lastImpact, world])

  // Shatter on landing: track each brick's peak speed; when it drops well below that peak it
  // has struck something, so it sheds its bonds — a falling/toppling welded slab breaks up
  // where it hits. Peak-drop (vs per-frame Δspeed) catches the multi-frame deceleration of a
  // damped, rigidly-bonded landing.
  useFrame(() => {
    const byBrick = bondsByBrickRef.current
    const bodies = bodiesRef.current
    const peak = peakSpeedRef.current
    if (bodies.length === 0) return
    for (let k = 0; k < bodies.length; k++) {
      const b = bodies[k]
      if (b.isSleeping()) {
        peak[k] = 0
        continue
      }
      const v = b.linvel()
      const speed = Math.hypot(v.x, v.y, v.z)
      if (speed > peak[k]) peak[k] = speed
      if (peak[k] >= LAND_MIN_SPEED && speed <= peak[k] * LAND_DROP_RATIO) {
        for (const bond of byBrick[k]) {
          if (bond.cut) continue
          world.removeImpulseJoint(bond.joint, true)
          bond.cut = true
        }
        peak[k] = 0 // reset so a later fall of the freed brick can re-trigger cleanly
      }
    }
  })

  useEffect(
    () => () => {
      if (bondsRef.current) for (const bond of bondsRef.current) if (!bond.cut) world.removeImpulseJoint(bond.joint, false)
      bondsRef.current = null
    },
    [world],
  )

  return null
}
