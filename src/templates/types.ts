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

export interface TemplateSpec {
  id: string
  name: string
  spawn?: SpawnMode
  /** Pure function returning the block instances. Called fresh on each (re)mount. */
  build: () => InstanceSpec[]
}
