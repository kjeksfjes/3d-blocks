import { Canvas } from '@react-three/fiber'
import { Leva } from 'leva'
import { Stage } from './scene/Stage'
import { Structure } from './scene/Structure'
import { Projectiles } from './scene/Projectiles'
import { AwakeMeter } from './scene/AwakeMeter'
import { InputController } from './interactions/InputController'
import { HUD } from './ui/HUD'
import { PerfReadout } from './ui/PerfReadout'
import { Tuning } from './ui/Tuning'
import { useStore } from './state/store'
import { templateMap } from './templates'

export default function App() {
  const activeTemplateId = useStore((s) => s.activeTemplateId)
  const resetNonce = useStore((s) => s.resetNonce)
  const template = templateMap[activeTemplateId]

  return (
    <div className="app">
      <Leva collapsed />
      <Tuning />
      <Canvas shadows dpr={[1, 1.5]} camera={{ position: [11, 7, 14], fov: 50 }}>
        <color attach="background" args={['#1a1a1f']} />
        <Stage>
          {/* Remounting on key change rebuilds the structure from scratch (reset). */}
          <Structure key={`${activeTemplateId}-${resetNonce}`} template={template} />
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
