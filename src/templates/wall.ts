import type { InstanceSpec, TemplateSpec, Vec3 } from './types'

const BRICK: Vec3 = [0.5, 0.25, 0.5]
const COLS = 36
const ROWS = 24

const BASE = '#b56b4a' // brick; per-block variation is added by the renderer

// A sturdy concrete pillar flanking each end: one solid, heavy block standing flush
// beside the wall, with each course's end brick welded to it (see `welds`) so the
// pillars anchor the wall and resist toppling. CONCRETE_GAP sits the pillar face flush
// with the outermost brick edge without overlapping at spawn.
const CONCRETE = '#8f8f8f'
const PILLAR_W = 0.9 // width across the wall (x)
const PILLAR_D = 1.2 // depth (z) — deeper than the wall for a stable buttress foot
const CONCRETE_GAP = 0

/**
 * Single source of the wall's geometry AND its welds, so the two can't drift out of
 * sync. Produces, in order: field bricks (row-major), the two pillars, then the
 * half-brick notch fillers. `welds` holds build-order index pairs.
 */
function layout(pillars: boolean): { blocks: InstanceSpec[]; welds: [number, number][] } {
  const [bw, bh] = BRICK
  const x0 = -(COLS * bw) / 2 + bw / 2
  const blocks: InstanceSpec[] = []
  const welds: [number, number][] = []

  // Field bricks. Running bond: shift every other course by half a brick, which leaves
  // a half-brick notch at one end of each course (the toothed ends).
  for (let r = 0; r < ROWS; r++) {
    const offset = r % 2 === 0 ? 0 : bw / 2
    for (let c = 0; c < COLS; c++) {
      blocks.push({ position: [x0 + c * bw + offset, bh / 2 + r * bh, 0], size: BRICK, color: BASE })
    }
  }

  // Without pillars it's a plain running-bond wall (toothed ends, no welds).
  if (!pillars) return { blocks, welds }

  // Pillars flank each end, flush with the outermost brick edge.
  const leftEdge = x0 - bw / 2 // even courses reach here on the left
  const rightEdge = x0 + COLS * bw // odd courses reach here on the right
  const wallHeight = ROWS * bh
  const pillar: Vec3 = [PILLAR_W, wallHeight, PILLAR_D]
  const pillarCx = (edge: number, side: 1 | -1) => edge + side * (CONCRETE_GAP + PILLAR_W / 2)
  const leftPillar = blocks.length
  blocks.push({ position: [pillarCx(leftEdge, -1), wallHeight / 2, 0], size: pillar, color: CONCRETE })
  const rightPillar = blocks.length
  blocks.push({ position: [pillarCx(rightEdge, 1), wallHeight / 2, 0], size: pillar, color: CONCRETE })

  // Weld each course's outermost full brick to the pillar on that side.
  for (let r = 0; r < ROWS; r++) {
    welds.push([r * COLS, leftPillar]) // leftmost brick
    welds.push([r * COLS + (COLS - 1), rightPillar]) // rightmost brick
  }

  // Half-brick fillers for the notches: odd courses are recessed on the left, even
  // courses on the right. Each filler sits flush in the notch and is welded to its
  // pillar so it stays part of the anchored end.
  const half: Vec3 = [bw / 2, bh, BRICK[2]]
  for (let r = 0; r < ROWS; r++) {
    const y = bh / 2 + r * bh
    const onLeft = r % 2 === 1
    const cx = onLeft ? leftEdge + bw / 4 : rightEdge - bw / 4
    const idx = blocks.length
    blocks.push({ position: [cx, y, 0], size: half, color: BASE })
    welds.push([idx, onLeft ? leftPillar : rightPillar])
  }

  return { blocks, welds }
}

const hasPillars = (toggles?: Record<string, boolean>) => toggles?.pillars ?? true

export const wall: TemplateSpec = {
  id: 'wall',
  name: 'Wall',
  // Solid feel: grippy, no bounce, damping to settle quickly without micro-jitter.
  physics: { friction: 1.45, restitution: 0, linearDamping: 1, angularDamping: 0.2 },
  toggles: [{ key: 'pillars', label: 'Pillars', default: true }],
  build: (toggles) => layout(hasPillars(toggles)).blocks,
  welds: (toggles) => layout(hasPillars(toggles)).welds,
}
