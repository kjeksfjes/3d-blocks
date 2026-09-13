import { useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { Leva } from 'leva'
import { Stage } from './scene/Stage'
import { Structure } from './scene/Structure'
import { Projectiles } from './scene/Projectiles'
import { AwakeMeter } from './scene/AwakeMeter'
import { ImpactSampler } from './scene/ImpactSampler'
import { InputController } from './interactions/InputController'
import { HUD } from './ui/HUD'
import { PerfReadout } from './ui/PerfReadout'
import { SceneControls } from './ui/SceneControls'
import { BlockPhysicsControls } from './ui/BlockPhysicsControls'
import { Tuning } from './ui/Tuning'
import { SoundControls } from './ui/SoundControls'
import { ResetButton } from './ui/ResetButton'
import { useStore } from './state/store'
import { templateMap } from './templates'
import type { SceneOptions } from './templates/types'

export default function App() {
  const activeTemplateId = useStore((s) => s.activeTemplateId)
  const resetNonce = useStore((s) => s.resetNonce)
  const sceneOptions = useStore((s) => s.sceneOptions)
  const destructionMode = useStore((s) => s.destructionMode)
  const template = templateMap[activeTemplateId]

  // Effective options for this scene: stored value or the template's default, limited
  // to this template's own keys. Derived by value (via the JSON key) so the identity is
  // stable across renders and only changes when an option actually changes.
  const optionsKey = JSON.stringify({
    ...Object.fromEntries(
      (template.toggles ?? []).map((t) => [t.key, sceneOptions[t.key] ?? t.default]),
    ),
    ...Object.fromEntries(
      (template.sliders ?? []).map((s) => [s.key, sceneOptions[s.key] ?? s.default]),
    ),
  })
  const options = useMemo(() => JSON.parse(optionsKey) as SceneOptions, [optionsKey])

  return (
    <div className="app">
      <Leva collapsed theme={{ sizes: { rootWidth: '340px' } }} />
      <SceneControls />
      <BlockPhysicsControls />
      <Tuning />
      <SoundControls />
      <ResetButton />
      <Canvas shadows dpr={[1, 1.5]} camera={{ position: [11, 7, 14], fov: 50 }}>
        <color attach="background" args={['#1a1a1f']} />
        <Stage>
          {/* Remounting on key change rebuilds the structure from scratch (reset). */}
          <Structure
            key={`${activeTemplateId}-${resetNonce}-${optionsKey}-${destructionMode}`}
            template={template}
            options={options}
            mode={destructionMode}
          />
          <Projectiles />
          <InputController />
          <AwakeMeter />
          <ImpactSampler />
        </Stage>
      </Canvas>
      <HUD />
      <PerfReadout />
    </div>
  )
}
