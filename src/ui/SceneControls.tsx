import { useEffect } from 'react'
import { useControls } from 'leva'
import { useStore } from '../state/store'
import { templateMap } from '../templates'
import type { TemplateSpec } from '../templates/types'

/** leva "Scene" panel for the active template's on/off options. Keyed by template id so
 *  switching scenes rebuilds the folder with that scene's controls. */
export function SceneControls() {
  const activeTemplateId = useStore((s) => s.activeTemplateId)
  const template = templateMap[activeTemplateId]
  return template?.toggles?.length ? (
    <SceneToggles key={activeTemplateId} template={template} />
  ) : (
    <NoToggles key={activeTemplateId} />
  )
}

function SceneToggles({ template }: { template: TemplateSpec }) {
  const setSceneToggles = useStore((s) => s.setSceneToggles)
  const schema = Object.fromEntries(
    (template.toggles ?? []).map((t) => [t.key, { value: t.default, label: t.label }]),
  )
  const values = useControls(`Scene: ${template.name}`, schema, { order: 11 })
  useEffect(() => {
    setSceneToggles(values as Record<string, boolean>)
  }, [values, setSceneToggles])
  return null
}

/** Clears scene toggles when the active scene has none, so no stale keys linger. */
function NoToggles() {
  const setSceneToggles = useStore((s) => s.setSceneToggles)
  useEffect(() => {
    setSceneToggles({})
  }, [setSceneToggles])
  return null
}
