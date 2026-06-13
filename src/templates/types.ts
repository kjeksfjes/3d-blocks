export type Vec3 = [number, number, number]

/** A single block in a structure. Positions are world-space; the structure
 *  is responsible for placing blocks so they rest on each other / the ground. */
export interface BlockSpec {
  position: Vec3
  /** Euler rotation in radians. Defaults to no rotation. */
  rotation?: Vec3
  size: Vec3
  /** Hex colour. Material treatment (wood/stone) is deferred to Phase 5. */
  color?: string
}

export interface TemplateSpec {
  id: string
  name: string
  /** Pure function returning the blocks to spawn. Called fresh on each (re)mount. */
  build: () => BlockSpec[]
}
