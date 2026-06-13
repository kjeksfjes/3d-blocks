import { create } from 'zustand'
import { defaultTemplateId } from '../templates'
import type { Vec3 } from '../templates/types'

/** Max live projectiles; oldest are culled so they can't accumulate unbounded. */
const MAX_PROJECTILES = 15

export interface Tuning {
  // Projectile — applies to the next shot.
  shootSpeed: number
  ballRadius: number
  ballDensity: number
  // Grab — applies to the next grab/throw.
  throwScale: number
  maxThrowSpeed: number
  heldAngularDamping: number
  // Blocks — baked in when a structure is built, so changes apply on Reset.
  blockFriction: number
  blockRestitution: number
}

export const DEFAULT_TUNING: Tuning = {
  shootSpeed: 26,
  ballRadius: 0.35,
  ballDensity: 8,
  throwScale: 1.2,
  maxThrowSpeed: 30,
  heldAngularDamping: 8,
  blockFriction: 0.9,
  blockRestitution: 0.1,
}

export interface Projectile {
  id: number
  position: Vec3
  velocity: Vec3
  radius: number
  density: number
}

interface AppState {
  activeTemplateId: string
  /** Bumped to force the structure to remount (= reset to its initial layout). */
  resetNonce: number
  projectiles: Projectile[]
  tuning: Tuning
  setTemplate: (id: string) => void
  reset: () => void
  fire: (position: Vec3, velocity: Vec3) => void
  setTuning: (partial: Partial<Tuning>) => void
}

let nextProjectileId = 0

export const useStore = create<AppState>((set) => ({
  activeTemplateId: defaultTemplateId,
  resetNonce: 0,
  projectiles: [],
  tuning: DEFAULT_TUNING,
  setTemplate: (id) => set({ activeTemplateId: id, resetNonce: 0, projectiles: [] }),
  reset: () => set((s) => ({ resetNonce: s.resetNonce + 1, projectiles: [] })),
  fire: (position, velocity) =>
    set((s) => {
      const { ballRadius, ballDensity } = s.tuning
      const shot: Projectile = {
        id: nextProjectileId++,
        position,
        velocity,
        radius: ballRadius,
        density: ballDensity,
      }
      const next = [...s.projectiles, shot]
      return { projectiles: next.length > MAX_PROJECTILES ? next.slice(-MAX_PROJECTILES) : next }
    }),
  setTuning: (partial) => set((s) => ({ tuning: { ...s.tuning, ...partial } })),
}))
