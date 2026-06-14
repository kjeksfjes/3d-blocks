import type { InstanceSpec, TemplateSpec, Vec3 } from './types'

// Three block sizes -> three instanced meshes: curtain/keep brick, smaller tower
// brick (for rounder rings), and a long lintel that bridges the gatehouse.
const BRICK: Vec3 = [0.5, 0.25, 0.5]
const TOWER_BRICK: Vec3 = [0.35, 0.25, 0.5]
const LINTEL: Vec3 = [4.8, 0.25, 0.5]
const BH = 0.25 // course height

// Single stone base; per-block variation is added by the renderer (tone ignores its arg).
const BASE = '#888d96'
const tone = (_n: number) => BASE

// Layout
const E = 6 // corner-tower centre offset from origin (±E on x and z)
const WALL_COURSES = 12
const TOWER_RADIUS = 1.2
const TOWER_COURSES = 18
const KEEP_HALF = 1.5
const KEEP_COURSES = 24
const GATE_HALF = 1.5 // half-width of the gateway opening
const LINTEL_HALF = 2.5 // half-width cleared for the lintel course (lintel abuts neighbours)

// Corner-tower centres; wall bricks landing within WALL_TRIM of one are dropped
// so curtain walls never overlap a tower ring.
const TOWER_CENTERS: [number, number][] = [
  [-E, -E],
  [E, -E],
  [-E, E],
  [E, E],
]
const WALL_TRIM = TOWER_RADIUS + 0.5

type Axis = 'x' | 'z'

export const castle: TemplateSpec = {
  id: 'castle',
  name: 'Castle',
  build(): InstanceSpec[] {
    const blocks: InstanceSpec[] = []

    // A round tower: bricks laid in rings, running-bond rotated each course,
    // crenellated on top. Each brick's depth points radially outward.
    const roundTower = (cx: number, cz: number) => {
      const [tw] = TOWER_BRICK
      const circ = 2 * Math.PI * TOWER_RADIUS
      const count = Math.max(8, Math.floor(circ / (tw * 1.15)))
      const step = (2 * Math.PI) / count
      for (let c = 0; c < TOWER_COURSES; c++) {
        const y = BH / 2 + c * BH
        const top = c === TOWER_COURSES - 1
        const angOffset = c % 2 === 0 ? 0 : step / 2
        for (let k = 0; k < count; k++) {
          if (top && k % 2 === 1) continue // crenellation
          const ang = k * step + angOffset
          blocks.push({
            position: [cx + Math.cos(ang) * TOWER_RADIUS, y, cz + Math.sin(ang) * TOWER_RADIUS],
            rotation: [0, Math.PI / 2 - ang, 0],
            size: TOWER_BRICK,
            color: tone(c + k),
          })
        }
      }
    }

    // A straight curtain wall running along `axis`, at the perpendicular
    // coordinate `fixed`, spanning [from, to]. Optional central gateway + lintel.
    const curtain = (axis: Axis, fixed: number, from: number, to: number, gate = false) => {
      const [bw] = BRICK
      const span = to - from
      const n = Math.max(1, Math.floor(span / bw))
      const start = from + (span - n * bw) / 2 + bw / 2
      const rot: Vec3 = axis === 'x' ? [0, 0, 0] : [0, Math.PI / 2, 0]
      const gateCourses = WALL_COURSES - 2

      for (let c = 0; c < WALL_COURSES; c++) {
        const y = BH / 2 + c * BH
        const top = c === WALL_COURSES - 1
        const offset = c % 2 === 0 ? 0 : bw / 2
        const lintelCourse = gate && c === gateCourses

        for (let i = 0; i < n; i++) {
          const along = start + i * bw + offset
          if (gate && c < gateCourses && Math.abs(along) < GATE_HALF) continue // doorway
          if (lintelCourse && Math.abs(along) < LINTEL_HALF) continue // clear for lintel
          if (top && i % 2 === 1) continue // crenellation
          const px = axis === 'x' ? along : fixed
          const pz = axis === 'x' ? fixed : along
          if (TOWER_CENTERS.some(([tx, tz]) => Math.hypot(px - tx, pz - tz) < WALL_TRIM)) {
            continue // would overlap a corner tower
          }
          blocks.push({ position: [px, y, pz], rotation: rot, size: BRICK, color: tone(c + i) })
        }

        if (lintelCourse) {
          const position: Vec3 = axis === 'x' ? [0, y, fixed] : [fixed, y, 0]
          blocks.push({ position, rotation: rot, size: LINTEL, color: tone(c) })
        }
      }
    }

    // A square keep (central donjon): four crenellated walls, taller than the curtain.
    const keep = () => {
      const [bw] = BRICK
      const n = Math.max(1, Math.floor((2 * KEEP_HALF) / bw))
      const start = -KEEP_HALF + (2 * KEEP_HALF - n * bw) / 2 + bw / 2
      for (let c = 0; c < KEEP_COURSES; c++) {
        const y = BH / 2 + c * BH
        const top = c === KEEP_COURSES - 1
        const offset = c % 2 === 0 ? 0 : bw / 2
        for (let i = 0; i < n; i++) {
          const a = start + i * bw + offset
          if (top && i % 2 === 1) continue
          // front/back walls (along x at z = ±KEEP_HALF)
          for (const z of [KEEP_HALF, -KEEP_HALF]) {
            blocks.push({ position: [a, y, z], size: BRICK, color: tone(c + i + 1) })
          }
          // side walls (along z at x = ±KEEP_HALF), inset by one brick to clear corners
          if (a > start && a < start + (n - 1) * bw) {
            for (const x of [KEEP_HALF, -KEEP_HALF]) {
              blocks.push({
                position: [x, y, a],
                rotation: [0, Math.PI / 2, 0],
                size: BRICK,
                color: tone(c + i + 1),
              })
            }
          }
        }
      }
    }

    // Corner towers
    roundTower(-E, -E)
    roundTower(E, -E)
    roundTower(-E, E)
    roundTower(E, E)

    // Curtain walls inset between the towers; gateway on the front (+z) wall.
    const inset = TOWER_RADIUS + 0.3
    curtain('x', E, -E + inset, E - inset, true)
    curtain('x', -E, -E + inset, E - inset)
    curtain('z', E, -E + inset, E - inset)
    curtain('z', -E, -E + inset, E - inset)

    keep()

    return blocks
  },
}
