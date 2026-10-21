import { z } from 'zod'
import type { CodeMatrix } from './codeMaterial/contract'
import { codeMaterialKeyframeSchema, compareCodeMaterialTime, type CodeMaterialKeyframe } from './codeMaterialAnimation'
import { clampVideoEditAnimationValue, interpolateVideoEditKeyframe } from './keyframeInterpolation'
import type { VideoEditSourceTime } from './time'

const number = z.number().finite()
export const codeElementOverrideValuesSchema = z.object({
  dx: number.min(-32768).max(32768).optional(), dy: number.min(-32768).max(32768).optional(),
  scale: number.min(.001).max(1024).optional(), scaleX: number.min(.001).max(1024).optional(), scaleY: number.min(.001).max(1024).optional(),
  rotation: number.min(-32768).max(32768).optional(), opacity: number.min(0).max(1).optional(),
  hidden: z.boolean().optional(),
}).strict()
export type CodeElementOverrideValues = z.infer<typeof codeElementOverrideValuesSchema>
export type CodeElementOverrideKey = keyof CodeElementOverrideValues
export const CODE_ELEMENT_OVERRIDE_KEYS = Object.keys(codeElementOverrideValuesSchema.shape) as CodeElementOverrideKey[]
const curves = z.partialRecord(z.enum(CODE_ELEMENT_OVERRIDE_KEYS as [CodeElementOverrideKey, ...CodeElementOverrideKey[]]), z.array(codeMaterialKeyframeSchema).min(1))
export const codeElementOverrideSchema = codeElementOverrideValuesSchema.extend({ curves: curves.optional() }).superRefine((value, ctx) => {
  for (const [key, points] of Object.entries(value.curves ?? {})) {
    const field = key as CodeElementOverrideKey
    const sorted = [...points].sort(compareCodeMaterialTime)
    for (let i = 0; i < sorted.length; i++) {
      const point = sorted[i]
      if (!codeElementOverrideValuesSchema.shape[field].safeParse(point.value).success) ctx.addIssue({ code: 'custom', message: `元素 ${key} 关键帧值无效。` })
      if (i && compareCodeMaterialTime(sorted[i - 1], point) === 0) ctx.addIssue({ code: 'custom', message: `元素 ${key} 的关键帧时刻重复。` })
      if (['text', 'fontFamily', 'hidden'].includes(key) && point.interpolation !== 'hold') ctx.addIssue({ code: 'custom', message: `元素 ${key} 只支持保持插值。` })
    }
  }
})
const overridesRecord = z.record(z.string().min(1).regex(/^(?!__proto__$)[\s\S]+$/, '此元素标识与对象保留名称冲突，请在源码中修改标识。'), codeElementOverrideSchema).superRefine((values, ctx) => {
  const ids = Object.values(values).flatMap(value => Object.values(value.curves ?? {}).flatMap(points => points.map(point => point.id)))
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: '元素覆盖的关键帧标识不能重复。' })
})
// Zod filters __proto__ before validating record keys; reject it before that filter
// so a successful mutation can never silently lose the user's requested edit.
export const codeElementOverridesSchema = z.preprocess((value, ctx) => {
  if (value && typeof value === 'object' && Object.hasOwn(value, '__proto__')) ctx.addIssue({ code: 'custom', message: '此元素标识与对象保留名称冲突，请在源码中修改标识。' })
  return value
}, overridesRecord)
export type CodeElementOverride = z.infer<typeof codeElementOverrideSchema>
export type CodeElementOverrides = z.infer<typeof codeElementOverridesSchema>
export function readCodeElementOverride(values: CodeElementOverrides | undefined, id: string): CodeElementOverride | undefined { return values && Object.hasOwn(values, id) ? values[id] : undefined }

/** Source-anchored curves survive trimming, speed changes and reversed playback. */
export function evaluateCodeElementOverride(value: CodeElementOverride, time: VideoEditSourceTime): CodeElementOverrideValues {
  const result: Record<string, unknown> = { ...value }; delete result.curves
  for (const [key, raw] of Object.entries(value.curves ?? {})) {
    const points = [...raw].sort(compareCodeMaterialTime)
    let lo = 0; let hi = points.length - 1
    if (compareCodeMaterialTime(time, points[lo]) <= 0) result[key] = points[lo].value
    else if (compareCodeMaterialTime(time, points[hi]) >= 0) result[key] = points[hi].value
    else {
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (compareCodeMaterialTime(points[mid], time) <= 0) lo = mid; else hi = mid }
      const seconds = (at: VideoEditSourceTime): number => at.sourceInUs + at.sourceRemainder.numerator / at.sourceRemainder.denominator
      result[key] = interpolateVideoEditKeyframe(points[lo].value, points[hi].value, (seconds(time) - seconds(points[lo])) / (seconds(points[hi]) - seconds(points[lo])), points[lo].interpolation, undefined, points[lo].bezier)
    }
    result[key] = clampVideoEditAnimationValue(result[key] as CodeMaterialKeyframe['value'], codeElementOverrideValuesSchema.shape[key as CodeElementOverrideKey])
  }
  return codeElementOverrideValuesSchema.parse(result)
}

export function codeInverseMatrix(m: CodeMatrix): CodeMatrix {
  const d = m[0] * m[3] - m[1] * m[2]
  if (Math.abs(d) < 1e-12) throw new Error('元素当前不可变换，请选择可见且有尺寸的元素。')
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]
}

/** Missing is derived from source identity, never persisted into an override or inferred from one hidden frame. */
export function codeElementOverrideStatus(overrides: CodeElementOverrides, sourceIds: ReadonlySet<string>): Array<{ elementId: string; missing: boolean }> {
  return Object.keys(overrides).map(elementId => ({ elementId, missing: !sourceIds.has(elementId) }))
}
