import { z } from 'zod'
import type { CodeMatrix } from './codeMaterial/contract'
import { codeMaterialKeyframeSchema, compareCodeMaterialTime, type CodeMaterialKeyframe } from './codeMaterialAnimation'
import { clampVideoEditAnimationValue, interpolateVideoEditKeyframe } from './keyframeInterpolation'
import type { VideoEditSourceTime } from './time'

const number = z.number().finite()
export const codeElementEffectKeySchema = z.string().min(1).refine(key => key !== '__proto__', '效果 key 不能是 __proto__。')
const effectValues = z.record(codeElementEffectKeySchema, z.union([z.number().finite(), z.string(), z.boolean()]))
export const codeElementEffectCurvesSchema = z.record(codeElementEffectKeySchema, z.array(codeMaterialKeyframeSchema).min(1)).superRefine((value, ctx) => {
  for (const [key, raw] of Object.entries(value)) {
    const points = [...raw].sort(compareCodeMaterialTime)
    if (points.some((point, i) => i > 0 && compareCodeMaterialTime(points[i - 1], point) === 0)) ctx.addIssue({ code: 'custom', message: `效果 ${key} 的关键帧时刻重复。` })
  }
})
export const codeElementEffectOverrideSchema = z.object({ enabled: z.boolean().optional(), values: effectValues.optional(), curves: codeElementEffectCurvesSchema.optional() }).strict()
export const codeElementAddedEffectSchema = z.object({ key: codeElementEffectKeySchema, id: z.string().min(1), params: effectValues, curves: codeElementEffectCurvesSchema.optional() }).strict()
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
export const codeElementOverrideSchema = codeElementOverrideValuesSchema.extend({ curves: curves.optional(), motionBlur: z.boolean().optional(), effects: z.record(codeElementEffectKeySchema, codeElementEffectOverrideSchema).optional(), addedEffects: z.array(codeElementAddedEffectSchema).optional() }).superRefine((value, ctx) => {
  const keys = value.addedEffects?.map(effect => effect.key) ?? []
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: 'custom', message: '追加效果的 key 不能重复。' })
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
  const ids = Object.values(values).flatMap(value => [...Object.values(value.curves ?? {}), ...Object.values(value.effects ?? {}).flatMap(effect => Object.values(effect.curves ?? {})), ...(value.addedEffects ?? []).flatMap(effect => Object.values(effect.curves ?? {}))].flatMap(points => points.map(point => point.id)))
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
export type CodeElementEffectOverride = z.infer<typeof codeElementEffectOverrideSchema>
export type CodeElementAddedEffect = z.infer<typeof codeElementAddedEffectSchema>
export type EvaluatedCodeElementOverride = CodeElementOverrideValues & { motionBlur?: boolean; effects?: Record<string, Omit<CodeElementEffectOverride, 'curves'>>; addedEffects?: Array<Omit<CodeElementAddedEffect, 'curves'>> }
export function readCodeElementOverride(values: CodeElementOverrides | undefined, id: string): CodeElementOverride | undefined { return values && Object.hasOwn(values, id) ? values[id] : undefined }

/** 调整层没有可变换的几何，静态值与动画通道遵守同一约束。 */
export function codeElementOverrideGeometryKeys(value: CodeElementOverride | undefined): CodeElementOverrideKey[] {
  return CODE_ELEMENT_OVERRIDE_KEYS.filter(key => key !== 'opacity' && key !== 'hidden' && (value?.[key] !== undefined || value?.curves?.[key] !== undefined))
}

export function assertCodeElementOverrideAllowed(kind: 'adjust' | undefined, value: CodeElementOverride | undefined): void {
  if (kind !== 'adjust' || !value) return
  const geometry = codeElementOverrideGeometryKeys(value)
  if (geometry.length) throw new Error(`调整层没有画面范围，不能修改位移、缩放或旋转（${geometry.join('、')}）；请修改效果参数或 opacity。`)
}

/** Source-anchored curves survive trimming, speed changes and reversed playback. */
export function evaluateCodeElementOverride(value: CodeElementOverride, time: VideoEditSourceTime): EvaluatedCodeElementOverride {
  const { effects, addedEffects, curves: _curves, motionBlur, ...result } = value
  const values: Record<string, unknown> = { ...result }
  for (const [key, raw] of Object.entries(value.curves ?? {})) {
    const points = [...raw].sort(compareCodeMaterialTime)
    let lo = 0; let hi = points.length - 1
    if (compareCodeMaterialTime(time, points[lo]) <= 0) values[key] = points[lo].value
    else if (compareCodeMaterialTime(time, points[hi]) >= 0) values[key] = points[hi].value
    else {
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (compareCodeMaterialTime(points[mid], time) <= 0) lo = mid; else hi = mid }
      const seconds = (at: VideoEditSourceTime): number => at.sourceInUs + at.sourceRemainder.numerator / at.sourceRemainder.denominator
      values[key] = interpolateVideoEditKeyframe(points[lo].value, points[hi].value, (seconds(time) - seconds(points[lo])) / (seconds(points[hi]) - seconds(points[lo])), points[lo].interpolation, undefined, points[lo].bezier)
    }
    values[key] = clampVideoEditAnimationValue(values[key] as CodeMaterialKeyframe['value'], codeElementOverrideValuesSchema.shape[key as CodeElementOverrideKey])
  }
  return { ...codeElementOverrideValuesSchema.parse(values), ...(motionBlur === undefined ? {} : { motionBlur }),
    ...(effects ? { effects: Object.fromEntries(Object.entries(effects).map(([key, effect]) => [key, { ...(effect.enabled === undefined ? {} : { enabled: effect.enabled }), values: evaluateCodeElementEffectValues(effect.values ?? {}, effect.curves, time) }])) } : {}),
    ...(addedEffects ? { addedEffects: addedEffects.map(({ curves, ...effect }) => ({ ...effect, params: evaluateCodeElementEffectValues(effect.params, curves, time) })) } : {}),
  }
}

/** 效果参数与变换用同一套源时间和插值器；范围由实际效果定义在叠加时钳制。 */
export function evaluateCodeElementEffectValues(values: Record<string, string | number | boolean>, curves: CodeElementEffectOverride['curves'], time: VideoEditSourceTime): Record<string, string | number | boolean> {
  const result = { ...values }
  for (const [key, raw] of Object.entries(curves ?? {})) {
    const points = [...raw].sort(compareCodeMaterialTime)
    const right = points.findIndex(point => compareCodeMaterialTime(point, time) > 0)
    const left = points[Math.max(0, right < 0 ? points.length - 1 : right - 1)]
    const end = points[right < 0 ? points.length - 1 : right]
    const at = (point: VideoEditSourceTime): number => point.sourceInUs + point.sourceRemainder.numerator / point.sourceRemainder.denominator
    const value = left === end ? left.value : interpolateVideoEditKeyframe(left.value, end.value, Math.max(0, (at(time) - at(left)) / (at(end) - at(left))), left.interpolation, undefined, left.bezier)
    // 写入已按效果参数类型校验；存档里类型不对的点按容错读取丢弃，回到静态值。
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') result[key] = value
  }
  return result
}

export function codeInverseMatrix(m: CodeMatrix): CodeMatrix {
  const d = m[0] * m[3] - m[1] * m[2]
  if (Math.abs(d) < 1e-12) throw new Error('元素当前不可变换，请选择可见且有尺寸的元素。')
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]
}

/** Missing is derived from source identity, never persisted into an override or inferred from one hidden frame. */
export function codeElementOverrideStatus(overrides: CodeElementOverrides, sourceIds: ReadonlySet<string>, effectKeys?: ReadonlyMap<string, ReadonlySet<string>>): Array<{ elementId: string; missing: boolean; effects?: Array<{ key: string; missing: boolean }> }> {
  return Object.entries(overrides).map(([elementId, value]) => ({ elementId, missing: !sourceIds.has(elementId), ...(value.effects ? { effects: Object.keys(value.effects).map(key => ({ key, missing: !sourceIds.has(elementId) || effectKeys?.has(elementId) === true && !effectKeys.get(elementId)!.has(key) })) } : {}) }))
}
