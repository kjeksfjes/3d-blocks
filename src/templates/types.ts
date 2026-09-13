export type Vec3 = [number, number, number]

/** One block instance within a structure. Each block carries its own box size;
 *  the renderer groups blocks of equal size into shared instanced meshes. */
export interface InstanceSpec {
  position: Vec3
  /** Euler rotation in radians. Defaults to no rotation. */
  rotation?: Vec3
  size: Vec3
  /** Hex colour. Material treatment (wood/stone) is deferred to Phase 5. */
  color?: string
}

/**
 * How a structure stabilises on spawn:
 * - 'pinned' (default): freeze blocks at their exact built positions. Instant, no
 *   settle — right for layouts that are already stable as built (wall, castle).
 * - 'settled': on first spawn, let it ease into a rested equilibrium once (heavily
 *   damped) and cache that; later spawns reuse it. Right for fragile shapes that
 *   would otherwise lurch when disturbed (the cylinder).
 */
export type SpawnMode = 'pinned' | 'settled'

/**
 * Per-template physics overrides. Only per-body params can vary by structure —
 * contact stiffness, solver iterations and timestep are global to the one shared
 * <Physics> world and cannot be set here. Each field falls back to the global
 * leva tuning (friction/restitution) or to 0 (damping) when omitted.
 */
export interface TemplatePhysics {
  friction?: number
  restitution?: number
  linearDamping?: number
  angularDamping?: number
}

/** A boolean scene option, surfaced in the leva "Scene" panel and passed to build()/welds(). */
export interface TemplateToggle {
  key: string
  label: string
  default: boolean
}

/** A numeric scene option, rendered as a slider in the "Scene" panel. Committed on
 *  release rather than per drag step, since each change rebuilds the whole structure. */
export interface TemplateSlider {
  key: string
  label: string
  default: number
  min: number
  max: number
  step?: number
}

/** Current values of a template's scene options, keyed by toggle/slider key. */
export type SceneOptions = Record<string, boolean | number>

export interface TemplateSpec {
  id: string
  name: string
  spawn?: SpawnMode
  /** Optional per-body physics "feel" overrides; see TemplatePhysics. */
  physics?: TemplatePhysics
  /** Scene-specific on/off options shown in the "Scene" panel; passed to build()/welds(). */
  toggles?: TemplateToggle[]
  /** Scene-specific numeric options shown as sliders in the "Scene" panel. */
  sliders?: TemplateSlider[]
  /** Pure function returning the block instances. Called fresh on each (re)mount. */
  build: (options?: SceneOptions) => InstanceSpec[]
  /**
   * Optional rigid welds, as pairs of `build()`-order indices. Each pair is joined by
   * a fixed joint that locks the two blocks' current relative pose, so they move as one
   * rigid assembly (e.g. anchoring a wall's end courses to its concrete pillars).
   * Assumes both blocks are axis-aligned (unrotated) at spawn. Receives the same options
   * as build() so the indices stay consistent.
   */
  welds?: (options?: SceneOptions) => [number, number][]
}
