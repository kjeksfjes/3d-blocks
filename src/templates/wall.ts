import type { InstanceSpec, TemplateSpec, Vec3 } from './types'

const BRICK: Vec3 = [0.5, 0.25, 0.5]
const COLS = 36
const ROWS = 24

const BASE = '#b56b4a' // brick; per-block variation is added by the renderer

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
          color: BASE,
        })
      }
    }
    return blocks
  },
}
