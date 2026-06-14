import type { TemplateSpec } from './types'
import { wall } from './wall'
import { jenga } from './jenga'
import { cylinder } from './cylinder'
import { castle } from './castle'

export const templates: TemplateSpec[] = [wall, jenga, cylinder, castle]

export const templateMap: Record<string, TemplateSpec> = Object.fromEntries(
  templates.map((t) => [t.id, t]),
)

export const defaultTemplateId = wall.id
