import { templates } from '../templates'
import { useStore } from '../state/store'

export function HUD() {
  const activeId = useStore((s) => s.activeTemplateId)
  const setTemplate = useStore((s) => s.setTemplate)
  const reset = useStore((s) => s.reset)

  return (
    <div className="hud">
      <div className="hud__group">
        {templates.map((t) => (
          <button
            key={t.id}
            className={`hud__btn${t.id === activeId ? ' hud__btn--active' : ''}`}
            onClick={() => setTemplate(t.id)}
          >
            {t.name}
          </button>
        ))}
      </div>
      <button className="hud__btn hud__btn--reset" onClick={reset}>
        Reset
      </button>
    </div>
  )
}
