import type { TemplateSpec } from './types'
import { wall } from './wall'
import { tower } from './tower'
import { pyramid } from './pyramid'
import { castle } from './castle'

export const templates: TemplateSpec[] = [wall, tower, pyramid, castle]

export const templateMap: Record<string, TemplateSpec> = Object.fromEntries(
  templates.map((t) => [t.id, t]),
)

export const defaultTemplateId = wall.id
