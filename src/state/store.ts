import { create } from 'zustand'
import { defaultTemplateId } from '../templates'
import type { SceneOptions, TemplateSpec, Vec3 } from '../templates/types'

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
}

export const DEFAULT_TUNING: Tuning = {
  shootSpeed: 26,
  ballRadius: 0.35,
  ballDensity: 8,
  throwScale: 1.2,
  maxThrowSpeed: 30,
  heldAngularDamping: 8,
}

export type ColorMode = 'none' | 'random' | 'palette'

/** Per-body block physics, applied LIVE to the current structure (tuning by feel) and
 *  remembered per scene for the session. */
export interface LivePhysics {
  friction: number
  restitution: number
  linearDamping: number
  angularDamping: number
}

/** Fallback block physics for templates that declare no `physics` of their own. */
export const DEFAULT_BLOCK_PHYSICS: LivePhysics = {
  friction: 0.9,
  restitution: 0.1,
  linearDamping: 0,
  angularDamping: 0,
}

/** A template's resolved block-physics defaults: its own `physics` over the fallback. */
export function templateLivePhysics(template: TemplateSpec): LivePhysics {
  const p = template.physics ?? {}
  return {
    friction: p.friction ?? DEFAULT_BLOCK_PHYSICS.friction,
    restitution: p.restitution ?? DEFAULT_BLOCK_PHYSICS.restitution,
    linearDamping: p.linearDamping ?? DEFAULT_BLOCK_PHYSICS.linearDamping,
    angularDamping: p.angularDamping ?? DEFAULT_BLOCK_PHYSICS.angularDamping,
  }
}

export interface Projectile {
  id: number
  position: Vec3
  velocity: Vec3
  radius: number
  density: number
}

/** A registered projectile impact, consumed by the destruction modes that react to hits.
 *  `id` increments so consumers can process each impact once. */
export interface Impact {
  id: number
  position: Vec3
  velocity: Vec3
}

/**
 * How a structure comes apart when hit:
 * - 'loose'  — plain dynamic bricks (default); realistic but a hit ripples through it.
 * - 'static' — bricks are fixed; only the struck region turns dynamic (localized shatter).
 * - 'welded' — bricks are bonded to their neighbours so the structure holds together like
 *   a solid; a hit breaks only the nearby bonds, so it fractures locally and topples whole.
 */
export type DestructionMode = 'loose' | 'static' | 'welded'

interface AppState {
  activeTemplateId: string
  /** Bumped to force the structure to remount (= reset to its initial layout). */
  resetNonce: number
  projectiles: Projectile[]
  tuning: Tuning
  /** How per-block colour variation is applied, and its strength (0–1). */
  colorMode: ColorMode
  colorVariation: number
  /** Awake (non-sleeping) rigid-body count, sampled a few times/sec for the readout. */
  awakeBodies: number
  /** Live per-body physics, remembered per scene (keyed by template id) for the session. */
  livePhysicsByScene: Record<string, LivePhysics>
  /** Current values of the active scene's options (keyed by toggle/slider key). */
  sceneOptions: SceneOptions
  /** How structures come apart when hit (see DestructionMode). */
  destructionMode: DestructionMode
  /** The latest projectile impact (consumed by the static/welded modes); null if none. */
  lastImpact: Impact | null
  setTemplate: (id: string) => void
  reset: () => void
  fire: (position: Vec3, velocity: Vec3) => void
  setTuning: (partial: Partial<Tuning>) => void
  setColor: (mode: ColorMode, variation: number) => void
  setAwakeBodies: (n: number) => void
  setSceneLivePhysics: (templateId: string, value: LivePhysics) => void
  setSceneOptions: (next: SceneOptions) => void
  setDestructionMode: (mode: DestructionMode) => void
  registerImpact: (position: Vec3, velocity: Vec3) => void
}

let nextProjectileId = 0

export const useStore = create<AppState>((set) => ({
  activeTemplateId: defaultTemplateId,
  resetNonce: 0,
  projectiles: [],
  tuning: DEFAULT_TUNING,
  colorMode: 'random',
  colorVariation: 0.5,
  awakeBodies: 0,
  livePhysicsByScene: {},
  sceneOptions: {},
  destructionMode: 'loose',
  lastImpact: null,
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
  setColor: (mode, variation) => set({ colorMode: mode, colorVariation: variation }),
  setAwakeBodies: (n) => set({ awakeBodies: n }),
  setSceneLivePhysics: (templateId, value) =>
    set((s) => ({ livePhysicsByScene: { ...s.livePhysicsByScene, [templateId]: value } })),
  setSceneOptions: (next) => set({ sceneOptions: next }),
  setDestructionMode: (mode) => set({ destructionMode: mode }),
  registerImpact: (position, velocity) =>
    set((s) => ({ lastImpact: { id: (s.lastImpact?.id ?? 0) + 1, position, velocity } })),
}))
