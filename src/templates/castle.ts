import type { BlockSpec, TemplateSpec, Vec3 } from './types'

const BRICK: Vec3 = [1, 0.5, 0.5]
const SPAN = 7 // bricks along each wall
const COURSES = 4 // wall height in courses
const TONES = ['#8a8f98', '#787d86', '#9aa0a8']

const bw = BRICK[0]
const bh = BRICK[1]
const half = ((SPAN - 1) / 2) * bw // wall centerlines sit at ±half

const tone = (n: number) => TONES[n % TONES.length]

// A square enclosure: front/back walls run along X, side walls along Z (rotated
// 90°). Side walls are inset by one brick so corners don't overlap. The top
// course is crenellated (every other merlon removed).
export const castle: TemplateSpec = {
  id: 'castle',
  name: 'Castle',
  build(): BlockSpec[] {
    const blocks: BlockSpec[] = []

    for (let c = 0; c < COURSES; c++) {
      const y = bh / 2 + c * bh
      const top = c === COURSES - 1

      // Front & back walls (run along X), full span.
      for (let i = 0; i < SPAN; i++) {
        if (top && i % 2 === 1) continue // crenellation gap
        const x = (i - (SPAN - 1) / 2) * bw
        for (const z of [half, -half]) {
          blocks.push({ position: [x, y, z], size: BRICK, color: tone(i + c) })
        }
      }

      // Side walls (run along Z, rotated), inset by one brick to clear corners.
      for (let j = 1; j < SPAN - 1; j++) {
        if (top && j % 2 === 1) continue
        const z = (j - (SPAN - 1) / 2) * bw
        for (const x of [half, -half]) {
          blocks.push({
            position: [x, y, z],
            rotation: [0, Math.PI / 2, 0],
            size: BRICK,
            color: tone(j + c),
          })
        }
      }
    }
    return blocks
  },
}
