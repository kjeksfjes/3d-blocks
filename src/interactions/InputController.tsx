import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useRapier, type RapierRigidBody } from '@react-three/rapier'
import { Plane, Quaternion, Vector2, Vector3 } from 'three'
import { useStore } from '../state/store'
import { audioManager } from '../audio/AudioManager'

const SPAWN_OFFSET = 1.2 // spawn ahead of the camera lens
const DRAG_THRESHOLD = 6 // px; beyond this an empty-space gesture is an orbit, not a shot
const TAP_TIMEOUT = 400 // ms; a slow press is not a shot
const GRAB_MAX_DISTANCE = 200 // ray length for picking a block
// "B" gives every block a launch velocity that points away from its nearby
// neighbours (summed), so each block repels the ones actually around it in all
// directions. Neighbours are found via a spatial grid (cell size >= radius).
const EXPLOSION_SPEED = 9
const EXPLOSION_RADIUS = 1.3
const EXPLOSION_CELL = 1.5

/**
 * Single source of pointer truth. Arbitrates three modeless gestures:
 *   - press on a dynamic body + move  -> GRAB: a spherical joint pins the grabbed
 *     point to a cursor-following anchor (rigid, no springiness) while leaving the
 *     block free to rotate, so it dangles/swings under gravity. Release -> THROW.
 *   - quick tap on empty space        -> SHOOT
 *   - Shift + tap (anywhere)          -> SHOOT (skips grab, so you can fire at a block)
 *   - drag on empty space             -> ORBIT (OrbitControls)
 */
export function InputController() {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const raycaster = useThree((s) => s.raycaster)
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null
  const { world, rapier } = useRapier()
  const fire = useStore((s) => s.fire)

  // Gesture state in refs so a drag never triggers React re-renders.
  const grabbed = useRef<RapierRigidBody | null>(null)
  const anchor = useRef<RapierRigidBody | null>(null)
  const joint = useRef<ReturnType<typeof world.createImpulseJoint> | null>(null)
  const plane = useRef(new Plane())
  const target = useRef(new Vector3())
  const startedOnBlock = useRef(false)
  const prevAngularDamping = useRef(0)
  const down = useRef({ x: 0, y: 0, t: 0 })

  // Scratch objects reused across events/frames.
  const ndc = useRef(new Vector2())
  const camDir = useRef(new Vector3())
  const tmp = useRef(new Vector3())
  const local = useRef(new Vector3())
  const quat = useRef(new Quaternion())

  useEffect(() => {
    const el = gl.domElement

    const setNdc = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      ndc.current.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
    }

    const release = () => {
      const body = grabbed.current
      if (joint.current) {
        world.removeImpulseJoint(joint.current, true)
        joint.current = null
      }
      if (anchor.current) {
        world.removeRigidBody(anchor.current)
        anchor.current = null
      }
      if (body) {
        body.setAngularDamping(prevAngularDamping.current) // restore pre-grab spin behaviour
        // The block already carries its drag velocity; boost + clamp for the throw.
        const { throwScale, maxThrowSpeed } = useStore.getState().tuning
        const v = body.linvel()
        tmp.current.set(v.x, v.y, v.z).multiplyScalar(throwScale)
        if (tmp.current.length() > maxThrowSpeed) tmp.current.setLength(maxThrowSpeed)
        body.setLinvel({ x: tmp.current.x, y: tmp.current.y, z: tmp.current.z }, true)
      }
      grabbed.current = null
      if (controls) controls.enabled = true
    }

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      audioManager.start() // unlock/resume audio on the first user gesture
      down.current = { x: e.clientX, y: e.clientY, t: performance.now() }
      startedOnBlock.current = false

      // Shift skips the grab so a click always shoots — even when aiming at a block.
      if (e.shiftKey) return

      setNdc(e)
      raycaster.setFromCamera(ndc.current, camera)
      const { origin, direction } = raycaster.ray
      const hit = world.castRay(new rapier.Ray(origin, direction), GRAB_MAX_DISTANCE, true)
      const body = hit?.collider.parent()
      if (!hit || !body || !body.isDynamic()) return

      // hit point in world space
      tmp.current.copy(origin).addScaledVector(direction, hit.timeOfImpact)

      // The grabbed point expressed in the body's local frame (so the joint
      // anchors exactly where you clicked, letting the block pivot around it).
      const bp = body.translation()
      const br = body.rotation()
      quat.current.set(br.x, br.y, br.z, br.w).invert()
      local.current.set(tmp.current.x - bp.x, tmp.current.y - bp.y, tmp.current.z - bp.z)
      local.current.applyQuaternion(quat.current)

      // Kinematic anchor that follows the cursor; spring joint pulls the block to it.
      const anchorBody = world.createRigidBody(
        rapier.RigidBodyDesc.newKinematicPositionBased().setTranslation(
          tmp.current.x,
          tmp.current.y,
          tmp.current.z,
        ),
      )
      joint.current = world.createImpulseJoint(
        rapier.JointData.spherical(
          { x: 0, y: 0, z: 0 },
          { x: local.current.x, y: local.current.y, z: local.current.z },
        ),
        anchorBody,
        body,
        true,
      )
      anchor.current = anchorBody
      grabbed.current = body
      startedOnBlock.current = true
      body.wakeUp() // bricks spawn asleep; ensure the grabbed one is active
      prevAngularDamping.current = body.angularDamping()
      body.setAngularDamping(useStore.getState().tuning.heldAngularDamping)

      // Drag in the screen plane at the grab point's depth.
      camera.getWorldDirection(camDir.current)
      plane.current.setFromNormalAndCoplanarPoint(camDir.current, tmp.current)
      target.current.copy(tmp.current)
      if (controls) controls.enabled = false
    }

    const onMove = (e: PointerEvent) => {
      if (!grabbed.current) return
      setNdc(e)
      raycaster.setFromCamera(ndc.current, camera)
      if (raycaster.ray.intersectPlane(plane.current, tmp.current)) {
        target.current.copy(tmp.current)
      }
    }

    const onUp = (e: PointerEvent) => {
      if (e.button !== 0) return
      if (grabbed.current) {
        release()
        return
      }
      if (startedOnBlock.current) return

      const moved = Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y)
      if (moved > DRAG_THRESHOLD || performance.now() - down.current.t > TAP_TIMEOUT) return

      setNdc(e)
      raycaster.setFromCamera(ndc.current, camera)
      const dir = raycaster.ray.direction
      const o = camera.position.clone().addScaledVector(dir, SPAWN_OFFSET)
      const { shootSpeed } = useStore.getState().tuning
      fire([o.x, o.y, o.z], [dir.x * shootSpeed, dir.y * shootSpeed, dir.z * shootSpeed])
    }

    // "B": launch each block away from the neighbours actually around it. Build a
    // spatial grid of block positions, sum a push-away vector per block from those
    // within EXPLOSION_RADIUS, and set that (normalised, +jitter) as its velocity.
    const explode = () => {
      const bodies: RapierRigidBody[] = []
      const xs: number[] = []
      const ys: number[] = []
      const zs: number[] = []
      world.forEachRigidBody((body) => {
        if (!body.isDynamic()) return
        const p = body.translation()
        bodies.push(body)
        xs.push(p.x)
        ys.push(p.y)
        zs.push(p.z)
      })
      const n = bodies.length
      if (n === 0) return

      const cell = (v: number) => Math.floor(v / EXPLOSION_CELL)
      const grid = new Map<string, number[]>()
      for (let i = 0; i < n; i++) {
        const k = `${cell(xs[i])},${cell(ys[i])},${cell(zs[i])}`
        const arr = grid.get(k)
        if (arr) arr.push(i)
        else grid.set(k, [i])
      }

      const r2 = EXPLOSION_RADIUS * EXPLOSION_RADIUS
      for (let i = 0; i < n; i++) {
        // seed with a small random vector so balanced/lone blocks still get a direction
        let vx = (Math.random() - 0.5) * 0.5
        let vy = (Math.random() - 0.5) * 0.5
        let vz = (Math.random() - 0.5) * 0.5
        const cx = cell(xs[i])
        const cy = cell(ys[i])
        const cz = cell(zs[i])
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
              const arr = grid.get(`${cx + dx},${cy + dy},${cz + dz}`)
              if (!arr) continue
              for (const j of arr) {
                if (j === i) continue
                const ox = xs[i] - xs[j]
                const oy = ys[i] - ys[j]
                const oz = zs[i] - zs[j]
                const d2 = ox * ox + oy * oy + oz * oz
                if (d2 > r2 || d2 < 1e-8) continue
                const d = Math.sqrt(d2)
                const w = (EXPLOSION_RADIUS - d) / EXPLOSION_RADIUS / d // closer neighbours push harder
                vx += ox * w
                vy += oy * w
                vz += oz * w
              }
            }
          }
        }
        const mag = Math.hypot(vx, vy, vz) || 1
        const s = EXPLOSION_SPEED * (0.7 + Math.random() * 0.6)
        bodies[i].setLinvel({ x: (vx / mag) * s, y: (vy / mag) * s, z: (vz / mag) * s }, true)
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'b' && e.key !== 'B') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return // don't fire while typing
      audioManager.start() // unlock/resume audio on the first user gesture
      explode()
    }

    // Capture phase so we can disable OrbitControls before its own handler runs.
    el.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', release)
    window.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', release)
      window.removeEventListener('keydown', onKey)
    }
  }, [camera, gl, raycaster, controls, world, rapier, fire])

  // Move the anchor to the cursor target each frame; the spring does the rest.
  useFrame(() => {
    if (anchor.current) anchor.current.setNextKinematicTranslation(target.current)
  })

  return null
}
