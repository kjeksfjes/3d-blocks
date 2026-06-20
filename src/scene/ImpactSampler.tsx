import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useRapier } from '@react-three/rapier'
import { audioManager } from '../audio/AudioManager'

// A sharp velocity change this big (since the last sample) = a collision mid-motion
// (ball on a wall, brick on brick). Kept high enough that resting jitter doesn't fizz.
const COLLISION_DV = 1.0
// Min PEAK speed for a come-to-rest landing to count. Low, because easing a block out
// of a wall moves it slowly (~0.5 m/s) before it settles. Loudness scales with the
// peak, so these are quiet, not absent.
const LAND_PEAK = 0.4
// A body whose speed falls below this is "at rest". Well under LAND_PEAK so a body
// must clearly stop (not just jitter near the threshold) to fire a landing.
const REST_SPEED = 0.2
// A settle only counts once the body has been continuously at rest for this many
// samples. A real landing holds still; lingering vibration keeps bouncing back above
// REST_SPEED and never stays quiet that long.
const REST_SAMPLES = 5
// Peak/|Δv| mapped to a full-intensity hit. A gentle settle (~0.5) is near-silent, a
// fall onto the floor (~5-8) near the loud end.
const MAX_DV = 9
// Summed hit energy that drives the rumble bed to full.
const BED_FULL = 70
// Most discrete clacks played in one sample; the rest fold into the bed.
const MAX_TRANSIENTS = 12
// Per-body cooldown (s) so one rattling brick can't machine-gun clacks...
const BODY_COOLDOWN = 0.045
// ...but a clearly louder impact (a tumbling brick's floor slam after a minor bump)
// overrides the cooldown so the big hit is never swallowed.
const LOUDER_OVERRIDE = 1.4
// Bound the cooldown map so a long session with resets can't grow it unbounded.
const COOLDOWN_MAP_CAP = 4096
// Hard cap on bodies inspected per sample, so cost stays bounded on huge scenes
// (cylinder/castle). Energy is scaled back up for the unsampled remainder.
const MAX_BODIES = 800
// Fixed sample interval, decoupled from the render frame.
const SAMPLE_INTERVAL = 1 / 40
// PHYSICS-FIRST GUARD: the sim uses a vary timestep (Stage.tsx) whose stability
// depends on a high, steady frame rate. If a frame already ran slower than this,
// skip the audio scan entirely — never let audio work deepen a frame-time dip and
// destabilise welded joints. ~33ms ≈ below 30fps.
const SLOW_FRAME_DT = 0.033

// Per-body tracking record, allocated ONCE per body and mutated in place — no
// per-frame allocation, so the scan creates no GC pressure (GC pauses were spiking
// frame times and destabilising the vary-timestep physics).
interface Rec {
  vx: number
  vy: number
  vz: number
  peak: number // peak speed since last hit/reset
  quiet: number // consecutive at-rest samples
  seen: number // generation tag of the last sample that saw this body
}

// Stable 0..1 from a body handle, so each block keeps the same "voice" (pitch/size)
// every time it's struck — a broad spread across a pile, not one homogenous tick.
function variantOf(handle: number): number {
  const h = Math.imul(handle ^ 0x9e3779b9, 2654435761) >>> 0
  return h / 0xffffffff
}

/**
 * The single source of impact audio. On a fixed interval it diffs each awake body's
 * velocity against the previous sample: a sharp change is a collision; having moved
 * then staying at rest is a landing/settle; a body that was moving and is now gone
 * (slept) is a landing too. Loudness scales with speed, so a tip is soft and a slam
 * is loud. It is allocation-free and yields whenever the frame is already slow, so
 * it can never drag the frame rate down and destabilise the (vary-timestep) physics.
 */
export function ImpactSampler() {
  const { world } = useRapier()
  const recs = useRef(new Map<number, Rec>())
  // handle -> { time, dv } of the last clack played for that body (for the cooldown).
  const lastPlay = useRef(new Map<number, { t: number; dv: number }>())
  const acc = useRef(0) // time accumulator for the fixed sample interval
  const gen = useRef(0) // sample generation, for detecting bodies that went away

  useFrame((state, dt) => {
    if (!audioManager.isAudible()) {
      if (recs.current.size) recs.current.clear() // drop stale state while silent
      return
    }
    // Physics first: if this frame was already slow, don't add to it.
    if (dt > SLOW_FRAME_DT) {
      acc.current = 0
      return
    }
    acc.current += dt
    if (acc.current < SAMPLE_INTERVAL) return // fixed-rate throttle
    acc.current = 0

    const t = state.clock.elapsedTime
    const map = recs.current
    const g = ++gen.current
    const impacts: { handle: number; dv: number }[] = []
    let energy = 0
    let total = 0
    let processed = 0

    world.forEachActiveRigidBody((b) => {
      if (!b.isDynamic()) return
      total++
      if (processed >= MAX_BODIES) return
      processed++
      const h = b.handle
      const v = b.linvel()
      const sp = Math.hypot(v.x, v.y, v.z)

      let r = map.get(h)

      // A grabbed brick is driven by the cursor, not colliding — keep its velocity
      // baseline current (so there's no false spike on release) but never sound it.
      if (audioManager.isGrabbed(h)) {
        if (r) {
          r.vx = v.x
          r.vy = v.y
          r.vz = v.z
          r.peak = 0
          r.quiet = 0
          r.seen = g
        } else {
          map.set(h, { vx: v.x, vy: v.y, vz: v.z, peak: 0, quiet: 0, seen: g })
        }
        return
      }

      if (!r) {
        // First sighting: establish a baseline, no detection yet.
        map.set(h, { vx: v.x, vy: v.y, vz: v.z, peak: sp, quiet: sp < REST_SPEED ? 1 : 0, seen: g })
        return
      }

      const dv = Math.hypot(v.x - r.vx, v.y - r.vy, v.z - r.vz)
      let pk = sp > r.peak ? sp : r.peak
      let quiet = sp < REST_SPEED ? r.quiet + 1 : 0

      // Two ways to register a hit:
      //  - a sharp velocity change = a collision while moving (ball on wall, etc.);
      //  - having moved, then holding still REST_SAMPLES samples = a landing/settle.
      let hit = 0
      if (dv >= COLLISION_DV) {
        hit = dv
        pk = 0
        quiet = 0
      } else if (quiet === REST_SAMPLES && pk >= LAND_PEAK) {
        hit = pk // fires once: quiet only equals REST_SAMPLES on a single sample
        pk = 0
      }
      if (hit > 0) {
        energy += hit
        impacts.push({ handle: h, dv: hit })
      }

      // Mutate in place — no allocation.
      r.vx = v.x
      r.vy = v.y
      r.vz = v.z
      r.peak = pk
      r.quiet = quiet
      r.seen = g
    })

    // Sweep records not seen this sample. When the cap wasn't hit, an unseen body
    // genuinely went to sleep — if it had been moving, that's a landing (use its
    // peak, since it may have slept mid-slowdown). When the cap WAS hit we can't
    // tell "slept" from "skipped by the cap", so just prune without firing.
    const capped = total > MAX_BODIES
    for (const [h, r] of map) {
      if (r.seen === g) continue
      if (!capped && r.peak >= LAND_PEAK) {
        energy += r.peak
        impacts.push({ handle: h, dv: r.peak })
      }
      map.delete(h)
    }

    // Scale energy up for bodies skipped past the cap, so big scenes still rumble.
    if (processed > 0 && total > processed) energy *= total / processed
    audioManager.bed(energy / BED_FULL)

    if (impacts.length) {
      impacts.sort((a, b) => b.dv - a.dv)
      if (lastPlay.current.size > COOLDOWN_MAP_CAP) lastPlay.current.clear()
      let played = 0
      for (const im of impacts) {
        if (played >= MAX_TRANSIENTS) break
        const last = lastPlay.current.get(im.handle)
        // Skip only if within cooldown AND not clearly louder than the last clack.
        if (last && t - last.t < BODY_COOLDOWN && im.dv < last.dv * LOUDER_OVERRIDE) continue
        lastPlay.current.set(im.handle, { t, dv: im.dv })
        const metal = audioManager.isProjectile(im.handle)
        audioManager.impact(im.dv / MAX_DV, metal ? 'metal' : 'brick', variantOf(im.handle))
        played++
      }
    }
  })

  return null
}
