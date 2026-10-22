import type { Flow, LayerId, Step } from './schema'

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

/** The step as seen through the lens: with the go-live layer on, its d-you overlay replaces example, tags and note. */
export function stepAt(step: Step, layers: ReadonlySet<LayerId>): Step {
  const g = step.golive
  if (!g || !layers.has('golive')) return step
  return { ...step, example: g.example ?? step.example, tags: g.tags ?? step.tags, note: g.note ?? step.note }
}

/** Every example a step can show: the spec example and its go-live overlay. */
export function stepExamples(step: Step): string[] {
  return [step.example, step.golive?.example].filter((e): e is string => !!e)
}
