import type { InstanceSpec, TemplateSpec, Vec3 } from './types'

// A tall hollow cylinder built from brick rings (like the castle's corner towers,
// scaled up). Each brick's depth points radially outward; courses use a running
// bond and the top is crenellated.
const BRICK: Vec3 = [0.4, 0.3, 0.5] // tangential width, height, radial depth
const RADIUS = 5
const COURSES = 43 // ~3,000 bricks at this radius
const TONES = ['#b8a888', '#a89878', '#c8b898', '#ad9d7d']

export const cylinder: TemplateSpec = {
  id: 'cylinder',
  name: 'Cylinder',
  spawn: 'settled', // fragile single-wall tower — pre-settle so it doesn't lurch when disturbed
  build(): InstanceSpec[] {
    const [bw, bh] = BRICK
    const circumference = 2 * Math.PI * RADIUS
    const count = Math.max(8, Math.floor(circumference / (bw * 1.1)))
    const step = (2 * Math.PI) / count

    const blocks: InstanceSpec[] = []
    for (let c = 0; c < COURSES; c++) {
      const y = bh / 2 + c * bh
      const top = c === COURSES - 1
      const angOffset = c % 2 === 0 ? 0 : step / 2
      for (let k = 0; k < count; k++) {
        if (top && k % 2 === 1) continue // crenellation
        const ang = k * step + angOffset
        blocks.push({
          position: [Math.cos(ang) * RADIUS, y, Math.sin(ang) * RADIUS],
          rotation: [0, Math.PI / 2 - ang, 0],
          size: BRICK,
          color: TONES[(c + k) % TONES.length],
        })
      }
    }
    return blocks
  },
}
