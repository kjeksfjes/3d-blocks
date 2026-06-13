import type { InstanceSpec, TemplateSpec, Vec3 } from './types'

const BRICK: Vec3 = [1, 0.5, 0.5]
const COLS = 18
const ROWS = 12

// Three muted brick tones, picked deterministically so colours are stable across resets.
const TONES = ['#b06a4a', '#c47b54', '#9c5e42']

export const wall: TemplateSpec = {
  id: 'wall',
  name: 'Wall',
  build(): InstanceSpec[] {
    const [bw, bh] = BRICK
    const x0 = -(COLS * bw) / 2 + bw / 2

    const blocks: InstanceSpec[] = []
    for (let r = 0; r < ROWS; r++) {
      // Running bond: shift every other course by half a brick (toothed ends are intentional).
      const offset = r % 2 === 0 ? 0 : bw / 2
      for (let c = 0; c < COLS; c++) {
        blocks.push({
          position: [x0 + c * bw + offset, bh / 2 + r * bh, 0],
          size: BRICK,
          color: TONES[(r + c) % TONES.length],
        })
      }
    }
    return blocks
  },
}
