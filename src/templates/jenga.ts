import type { InstanceSpec, TemplateSpec, Vec3 } from './types'

// Jenga-style tower: each layer is 3 planks; alternate layers rotate 90°.
const PLANK: Vec3 = [1.5, 0.3, 0.5]
const LAYERS = 18
const BASE = '#c2a06a' // wood; per-block variation is added by the renderer

export const jenga: TemplateSpec = {
  id: 'jenga',
  name: 'Jenga',
  // Solid feel: grippy, no bounce, damping to settle quickly without micro-jitter.
  physics: { friction: 1.45, restitution: 0, linearDamping: 1, angularDamping: 0.2 },
  build(): InstanceSpec[] {
    const [, , w] = PLANK
    const h = PLANK[1]
    const blocks: InstanceSpec[] = []

    for (let layer = 0; layer < LAYERS; layer++) {
      const y = h / 2 + layer * h
      const rotated = layer % 2 === 1
      // Three planks side by side, spaced by their width across the perpendicular axis.
      for (let i = -1; i <= 1; i++) {
        const along = i * w
        blocks.push({
          position: rotated ? [along, y, 0] : [0, y, along],
          rotation: rotated ? [0, Math.PI / 2, 0] : [0, 0, 0],
          size: PLANK,
          color: BASE,
        })
      }
    }
    return blocks
  },
}
