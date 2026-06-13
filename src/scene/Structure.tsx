import { useMemo } from 'react'
import type { TemplateSpec } from '../templates/types'
import { Block } from './Block'

/** Renders a template's blocks. Remount with a new `key` to reset the structure. */
export function Structure({ template }: { template: TemplateSpec }) {
  const blocks = useMemo(() => template.build(), [template])
  return (
    <>
      {blocks.map((spec, i) => (
        <Block key={i} spec={spec} />
      ))}
    </>
  )
}
