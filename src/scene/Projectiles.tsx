import { useStore } from '../state/store'
import { Projectile } from './Projectile'

/** Renders all live projectiles from the store. */
export function Projectiles() {
  const projectiles = useStore((s) => s.projectiles)
  return (
    <>
      {projectiles.map((p) => (
        <Projectile
          key={p.id}
          position={p.position}
          velocity={p.velocity}
          radius={p.radius}
          density={p.density}
        />
      ))}
    </>
  )
}
