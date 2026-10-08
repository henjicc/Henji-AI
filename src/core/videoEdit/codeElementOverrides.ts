import { z } from 'zod'
import { CODE_V3_LIMITS, CodeMaterialError, type CodeDrawCommand, type CodeMatrix, type CodeTextMeasurer } from './codeMaterial/contract'
import { codeLocalBounds, codeMultiply, codeTransform } from './codeMaterial/geometry'
import { codeMaterialKeyframeSchema, compareCodeMaterialTime, type CodeMaterialKeyframe } from './codeMaterialAnimation'
import { clampVideoEditAnimationValue, interpolateVideoEditKeyframe } from './keyframeInterpolation'
import type { VideoEditSourceTime } from './time'

const number = z.number().finite()
const color = z.tuple([number.min(0).max(1), number.min(0).max(1), number.min(0).max(1), number.min(0).max(1)])
export const codeElementOverrideValuesSchema = z.object({
  dx: number.min(-32768).max(32768).optional(), dy: number.min(-32768).max(32768).optional(),
  scale: number.min(.001).max(1024).optional(), scaleX: number.min(.001).max(1024).optional(), scaleY: number.min(.001).max(1024).optional(),
  rotation: number.min(-32768).max(32768).optional(), opacity: number.min(0).max(1).optional(),
  fill: color.optional(), stroke: color.optional(), text: z.string().max(4096).optional(),
  fontFamily: z.string().min(1).max(200).regex(/^[^\r\n;{}]+$/).optional(), fontWeight: number.min(1).max(1000).optional(),
  fontSize: number.min(1).max(1024).optional(), letterSpacing: number.min(-1024).max(1024).optional(), lineHeight: number.min(.1).max(10).optional(), hidden: z.boolean().optional(),
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

/** Alias IDs must be identical for paint, selection, annotations and persistence. */
export function identifyCodeElements(commands: readonly CodeDrawCommand[]): CodeDrawCommand[] {
  const counts = new Map<string, number>()
  const count = (commands: readonly CodeDrawCommand[]): void => { commands.forEach((command, i) => { const id = command.elementId ?? `draw:${i}`; counts.set(id, (counts.get(id) ?? 0) + 1); if (command.kind === 'group') count(command.children) }) }
  count(commands)
  const visit = (commands: readonly CodeDrawCommand[]): CodeDrawCommand[] => commands.map((command, i) => {
    const id = command.elementId ?? `draw:${i}`
    const next = { ...command, authorElementId: id, elementId: counts.get(id)! > 1 ? `${id}@${JSON.stringify(command.elementPath ?? [])}` : id }
    return next.kind === 'group' ? { ...next, children: visit(next.children) } : next
  })
  return visit(commands)
}
export function codeInverseMatrix(m: CodeMatrix): CodeMatrix {
  const d = m[0] * m[3] - m[1] * m[2]
  if (Math.abs(d) < 1e-12) throw new Error('元素当前不可变换，请选择可见且有尺寸的元素。')
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]
}

/** Append a parent-space correction after the author's transform, before paint. No second scene graph. */
export function applyCodeElementOverrides(commands: readonly CodeDrawCommand[], overrides: CodeElementOverrides, time: VideoEditSourceTime, measureText: CodeTextMeasurer): CodeDrawCommand[] {
  const visit = (command: CodeDrawCommand): CodeDrawCommand => {
    const next: CodeDrawCommand = command.kind === 'group' ? { ...command, children: command.children.map(visit) } : { ...command }
    const raw = readCodeElementOverride(overrides, command.elementId ?? ''); if (!raw) return next
    const value = evaluateCodeElementOverride(raw, time)
    if (value.hidden) next.opacity = 0
    else if (value.opacity !== undefined) next.opacity = value.opacity
    if (value.fill) {
      next.paint = value.fill
      if ('fill' in next) next.fill = value.fill
      if ('color' in next) next.color = value.fill
    }
    if (value.stroke) next.stroke = value.stroke
    if (next.kind === 'text') {
      for (const key of ['text', 'fontFamily', 'fontWeight', 'fontSize', 'letterSpacing', 'lineHeight'] as const) if (value[key] !== undefined) Object.assign(next, { [key]: value[key] })
      next.layout = measureText({ text: next.text, fontFamily: next.fontFamily, fontWeight: next.fontWeight ?? 400, fontStyle: next.fontStyle ?? 'normal', fontSize: next.fontSize, letterSpacing: next.letterSpacing ?? 0, lineHeight: next.lineHeight ?? 1.2, maxWidth: next.maxWidth ?? 0, wrap: next.wrap ?? false, maxLines: next.maxLines ?? 0 })
      if (value.text !== undefined) next.perChar = undefined
    }
    next.elementTransform = codeElementCorrection(next, value)
    return next
  }
  const result = commands.map(visit)
  let characters = 0
  const count = (commands: readonly CodeDrawCommand[]): void => { for (const command of commands) { if (command.kind === 'text') characters += command.text.length; if (command.kind === 'group') count(command.children) } }
  count(result)
  if (characters > CODE_V3_LIMITS.textCharacters) throw new CodeMaterialError('BUDGET', '本帧覆盖后文字超出文字绘制预算。')
  return result
}
export function codeElementCorrection(command: CodeDrawCommand, value: CodeElementOverrideValues): CodeMatrix {
  const next = { ...command, elementTransform: undefined }; const local = codeLocalBounds(next); const base = codeTransform(next)
  const center = next.authorAnchor ? [(next.anchorX ?? 0) + (next.kind !== 'group' && 'x' in next ? next.x : 0), (next.anchorY ?? 0) + (next.kind !== 'group' && 'y' in next ? next.y : 0)] : [local.x + local.width / 2, local.y + local.height / 2]
  const angle = (value.rotation ?? 0) * Math.PI / 180; const c = Math.cos(angle); const s = Math.sin(angle)
  const sx = (value.scale ?? 1) * (value.scaleX ?? 1); const sy = (value.scale ?? 1) * (value.scaleY ?? 1)
  const relative: CodeMatrix = [c * sx, s * sx, -s * sy, c * sy, center[0] - c * sx * center[0] + s * sy * center[1], center[1] - s * sx * center[0] - c * sy * center[1]]
  // Scaling follows the element's own axes, including an author's existing rotation;
  // parent-axis nonuniform scaling would shear its oriented selection rectangle.
  if (Math.abs(base[0] * base[3] - base[1] * base[2]) < 1e-12) return [1, 0, 0, 1, value.dx ?? 0, value.dy ?? 0]
  return codeMultiply([1, 0, 0, 1, value.dx ?? 0, value.dy ?? 0], codeMultiply(base, codeMultiply(relative, codeInverseMatrix(base))))
}

/** Missing is derived from source identity, never persisted into an override or inferred from one hidden frame. */
export function codeElementOverrideStatus(overrides: CodeElementOverrides, sourceIds: ReadonlySet<string>): Array<{ elementId: string; missing: boolean }> {
  return Object.keys(overrides).map(elementId => ({ elementId, missing: !sourceIds.has(elementId) }))
}
export function codeElementParentMatrix(element: { command: CodeDrawCommand; matrix: CodeMatrix }): CodeMatrix { return codeMultiply(element.matrix, codeInverseMatrix(codeTransform(element.command))) }
