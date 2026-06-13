import type { InstanceSpec, TemplateSpec, Vec3 } from './types'

const SIZE: Vec3 = [1, 0.6, 1]
const BASE = 9 // blocks per side at the bottom course
const TONES = ['#c9b79c', '#bda77f', '#d6c6a8']

// A stepped (ziggurat-style) pyramid: each course is a solid square grid one
// block narrower per side than the course below, centred on the one beneath.
export const pyramid: TemplateSpec = {
  id: 'pyramid',
  name: 'Pyramid',
  build(): InstanceSpec[] {
    const [sx, sy, sz] = SIZE
    const blocks: InstanceSpec[] = []

    for (let layer = 0; layer < BASE; layer++) {
      const n = BASE - layer
      const y = sy / 2 + layer * sy
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          blocks.push({
            position: [(i - (n - 1) / 2) * sx, y, (j - (n - 1) / 2) * sz],
            size: SIZE,
            color: TONES[(i + j + layer) % TONES.length],
          })
        }
      }
    }
    return blocks
  },
}
