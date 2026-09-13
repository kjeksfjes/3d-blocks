import { useEffect, useRef } from 'react'
import { useControls } from 'leva'
import { useStore } from '../state/store'
import { templateMap } from '../templates'
import type { SceneOptions, TemplateSpec } from '../templates/types'
import { useResetDefaults } from './resetDefaults'

/** leva "Scene" panel for the active template's options. Keyed by template id so
 *  switching scenes rebuilds the folder with that scene's controls. */
export function SceneControls() {
  const activeTemplateId = useStore((s) => s.activeTemplateId)
  const template = templateMap[activeTemplateId]
  const hasOptions = (template?.toggles?.length ?? 0) + (template?.sliders?.length ?? 0) > 0
  return hasOptions ? (
    <SceneOptionControls key={activeTemplateId} template={template} />
  ) : (
    <NoOptions key={activeTemplateId} />
  )
}

function SceneOptionControls({ template }: { template: TemplateSpec }) {
  const setSceneOptions = useStore((s) => s.setSceneOptions)
  const toggleDefs = template.toggles ?? []
  const sliderDefs = template.sliders ?? []

  // Current values, held in a ref so toggles and sliders can publish independently.
  // Sliders publish on release only (`onEditEnd`): every change rebuilds the whole
  // structure, which is far too heavy to do on each step of a drag.
  const defaults: SceneOptions = {
    ...Object.fromEntries(toggleDefs.map((t) => [t.key, t.default])),
    ...Object.fromEntries(sliderDefs.map((s) => [s.key, s.default])),
  }
  const current = useRef<SceneOptions>(defaults)
  const publish = (partial: SceneOptions) => {
    current.current = { ...current.current, ...partial }
    setSceneOptions(current.current)
  }

  const schema = {
    ...Object.fromEntries(toggleDefs.map((t) => [t.key, { value: t.default, label: t.label }])),
    ...Object.fromEntries(
      sliderDefs.map((s) => [
        s.key,
        {
          value: s.default,
          min: s.min,
          max: s.max,
          step: s.step ?? 1,
          label: s.label,
          onEditEnd: (v: number) => publish({ [s.key]: v }),
        },
      ]),
    ),
  }
  const [values, set] = useControls(`Scene: ${template.name}`, () => schema, { order: 11 })

  // A programmatic `set` doesn't fire onEditEnd, so publish the defaults alongside it.
  useResetDefaults('scene', () => {
    set(defaults)
    publish(defaults)
  })

  // Toggles apply immediately. Derived by value (via the JSON key) so the effect only
  // runs when a toggle actually changes, not on every slider step.
  const togglesKey = JSON.stringify(
    Object.fromEntries(toggleDefs.map((t) => [t.key, (values as SceneOptions)[t.key]])),
  )
  useEffect(() => {
    publish(JSON.parse(togglesKey) as SceneOptions)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [togglesKey])
  return null
}

/** Clears scene options when the active scene has none, so no stale keys linger. */
function NoOptions() {
  const setSceneOptions = useStore((s) => s.setSceneOptions)
  useEffect(() => {
    setSceneOptions({})
  }, [setSceneOptions])
  return null
}
