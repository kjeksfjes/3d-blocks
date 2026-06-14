import { useStore } from '../state/store'

/** Small overlay showing how many rigid bodies are currently awake (moving).
 *  Should fall to ~0 once a structure settles or a collapse comes to rest. */
export function PerfReadout() {
  const awake = useStore((s) => s.awakeBodies)
  return <div className="perf">awake: {awake}</div>
}
