import { useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { Leva } from 'leva'
import { Stage } from './scene/Stage'
import { Structure } from './scene/Structure'
import { Projectiles } from './scene/Projectiles'
import { AwakeMeter } from './scene/AwakeMeter'
import { InputController } from './interactions/InputController'
import { HUD } from './ui/HUD'
import { PerfReadout } from './ui/PerfReadout'
import { SceneControls } from './ui/SceneControls'
import { BlockPhysicsControls } from './ui/BlockPhysicsControls'
import { Tuning } from './ui/Tuning'
import { useStore } from './state/store'
import { templateMap } from './templates'

export default function App() {
  const activeTemplateId = useStore((s) => s.activeTemplateId)
  const resetNonce = useStore((s) => s.resetNonce)
  const sceneToggles = useStore((s) => s.sceneToggles)
  const template = templateMap[activeTemplateId]

  // Effective toggles for this scene: stored value or the template's default, limited
  // to this template's own keys. Derived by value (via the JSON key) so the identity is
  // stable across renders and only changes when a toggle actually changes.
  const togglesKey = JSON.stringify(
    Object.fromEntries((template.toggles ?? []).map((t) => [t.key, sceneToggles[t.key] ?? t.default])),
  )
  const toggles = useMemo(() => JSON.parse(togglesKey) as Record<string, boolean>, [togglesKey])

  return (
    <div className="app">
      <Leva collapsed theme={{ sizes: { rootWidth: '340px' } }} />
      <SceneControls />
      <BlockPhysicsControls />
      <Tuning />
      <Canvas shadows dpr={[1, 1.5]} camera={{ position: [11, 7, 14], fov: 50 }}>
        <color attach="background" args={['#1a1a1f']} />
        <Stage>
          {/* Remounting on key change rebuilds the structure from scratch (reset). */}
          <Structure key={`${activeTemplateId}-${resetNonce}-${togglesKey}`} template={template} toggles={toggles} />
          <Projectiles />
          <InputController />
          <AwakeMeter />
        </Stage>
      </Canvas>
      <HUD />
      <PerfReadout />
    </div>
  )
}
