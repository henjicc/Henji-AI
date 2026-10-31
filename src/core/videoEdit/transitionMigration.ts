import { videoEditTransitionBinding } from './transitionCatalog'
import { VIDEO_EDIT_SOURCE_TRANSITION_PARAMS } from './transitionSources'

type RecordValue = Record<string, unknown>
const isRecord = (value: unknown): value is RecordValue => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** 只换 ID、方式和参数键；填入来源默认值，动画点及切点、时长、单侧关系原样保留。 */
export function migrateVideoEditTransitionCollection(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.transitions)) return value
  return { ...value, transitions: value.transitions.map(transition => {
    if (!isRecord(transition) || typeof transition.kind !== 'string') return transition
    const binding = videoEditTransitionBinding(transition.kind)
    if (!binding) return transition
    if (binding.entry.kind === transition.kind && binding.entry.variants.length === 1) return transition
    const parameters = isRecord(transition.parameters) ? transition.parameters : {}
    const renamed = Object.fromEntries(Object.entries(parameters).map(([key, parameter]) => [binding.keys.get(key) ?? key, parameter]))
    for (const parameter of VIDEO_EDIT_SOURCE_TRANSITION_PARAMS[binding.variant[2]]) {
      const target = binding.keys.get(parameter.key)!
      if (!(target in renamed)) renamed[target] = parameter.default
    }
    const frameCurves = isRecord(transition.frameCurves) ? Object.fromEntries(Object.entries(transition.frameCurves).map(([key, points]) => [binding.keys.get(key) ?? key, structuredClone(points)])) : undefined
    return { ...transition, kind: binding.entry.kind, parameters: { ...renamed, ...(binding.entry.variants.length > 1 ? { mode: binding.variant[0] } : {}) }, ...(frameCurves ? { frameCurves } : {}) }
  }) }
}

export function migrateVideoEditTransitions(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.sequences)) return value
  return { ...value, sequences: value.sequences.map(migrateVideoEditTransitionCollection) }
}

/** 录制的剪辑基线是唯一快照入口，不遍历任意作者数据。 */
export function migrateRecordingTransitions(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.scriptCapture) || !Array.isArray(value.scriptCapture.baselines)) return value
  return { ...value, scriptCapture: { ...value.scriptCapture, baselines: value.scriptCapture.baselines.map(baseline => isRecord(baseline) ? { ...baseline, content: migrateVideoEditTransitions(baseline.content) } : baseline) } }
}
