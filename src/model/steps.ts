import type { Flow, Step } from './schema'

/** Display number of a step: "4" for a top-level step, "4.2" for the second substep of step 4. */
export function stepNumber(flow: Flow, step: Step): string {
  let top = 0
  let sub = 0
  for (const s of flow.steps) {
    if (s.parent) sub++
    else {
      top++
      sub = 0
    }
    if (s.id === step.id) return s.parent ? `${top}.${sub}` : String(top)
  }
  return '?'
}
