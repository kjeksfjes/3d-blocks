import { useEffect, useRef } from 'react'
import { button, useControls } from 'leva'
import { templateLivePhysics, useStore, type LivePhysics } from '../state/store'
import { templateMap } from '../templates'
import type { TemplateSpec } from '../templates/types'

/** "Block physics" panel. Per scene: seeds from the remembered session values or the
 *  template's defaults, applies live, and offers a reset-to-defaults button. Keyed by
 *  template id, and the folder name carries the scene name so leva keeps each scene's
 *  controls independent (it keys state by the control path, not by React identity). */
export function BlockPhysicsControls() {
  const activeTemplateId = useStore((s) => s.activeTemplateId)
  return <Inner key={activeTemplateId} template={templateMap[activeTemplateId]} />
}

function Inner({ template }: { template: TemplateSpec }) {
  const setSceneLivePhysics = useStore((s) => s.setSceneLivePhysics)
  const defaults = templateLivePhysics(template)
  // Remembered session values for this scene win over the template defaults. Read once
  // at mount (the component is keyed by scene, so a switch remounts with fresh values).
  const initial = useStore.getState().livePhysicsByScene[template.id] ?? defaults

  // `set` re-seeds the sliders; held in a ref so the reset button can reach the latest.
  const setRef = useRef<(v: Partial<LivePhysics>) => void>(null)
  const [values, set] = useControls(
    `Block physics: ${template.name}`,
    () => ({
      friction: { value: initial.friction, min: 0, max: 2, step: 0.05 },
      restitution: { value: initial.restitution, min: 0, max: 1, step: 0.05 },
      linearDamping: { value: initial.linearDamping, min: 0, max: 5, step: 0.05 },
      angularDamping: { value: initial.angularDamping, min: 0, max: 5, step: 0.05 },
      'Reset to defaults': button(() => setRef.current?.(defaults)),
    }),
    { order: 3 },
  )
  setRef.current = set

  useEffect(() => {
    setSceneLivePhysics(template.id, {
      friction: values.friction,
      restitution: values.restitution,
      linearDamping: values.linearDamping,
      angularDamping: values.angularDamping,
    })
  }, [values, template.id, setSceneLivePhysics])

  return null
}
