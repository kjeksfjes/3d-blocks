import { button, useControls } from 'leva'
import { resetAllDefaults } from './resetDefaults'

/** The panel-wide "Reset to defaults" button, ordered last so it sits below every folder
 *  it resets (block physics and the active scene's options). */
export function ResetButton() {
  useControls({ 'Reset to defaults': button(() => resetAllDefaults()) }, { order: 12 })
  return null
}
