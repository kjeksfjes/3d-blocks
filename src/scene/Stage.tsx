import type { ReactNode } from 'react'
import { OrbitControls, Environment, ContactShadows } from '@react-three/drei'
import { Physics, RigidBody } from '@react-three/rapier'

/** Lighting, ground, environment and camera controls. Wraps the dynamic
 *  structure (passed as children) in the physics world alongside the ground. */
export function Stage({ children }: { children: ReactNode }) {
  return (
    <>
      <ambientLight intensity={0.4} />
      <hemisphereLight args={['#cfe8ff', '#3a2f25', 0.5]} />
      <directionalLight
        position={[8, 12, 6]}
        intensity={2.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
      />

      {/* "vary" runs one physics step per frame, so heavy collapses degrade to slight
          slow-motion instead of spiralling on fixed-timestep catch-up steps. The
          spawn lurch this could cause is absorbed by spawning structures asleep
          (see Structure); SIMD keeps the solver fast. */}
      <Physics timeStep="vary">
        {children}

        {/* Ground */}
        <RigidBody type="fixed" friction={1}>
          <mesh position={[0, -0.25, 0]} receiveShadow>
            <boxGeometry args={[60, 0.5, 60]} />
            <meshStandardMaterial color="#6f7682" roughness={0.95} />
          </mesh>
        </RigidBody>
      </Physics>

      <ContactShadows position={[0, 0.01, 0]} opacity={0.4} scale={50} blur={2} far={12} />
      <Environment preset="city" />
      <OrbitControls makeDefault target={[0, 1.5, 0]} maxPolarAngle={Math.PI / 2.05} />
    </>
  )
}
