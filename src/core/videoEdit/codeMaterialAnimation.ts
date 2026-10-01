import { z } from 'zod'
import { CodeMaterialError } from './codeMaterial/contract'
import type { CodeColor, CodeParameterDeclaration, CodeParameterValue, CodeParameterValues } from './codeMaterial/contract'
import { validateCodeMaterialParameterValue, validateCodeMaterialParameters } from './codeMaterial/parameters'
import type { CodeMaterialMetadata } from './codeMaterialDocument'
import type { CodeMaterialInstance } from './codeMaterialPersistence'
import type { VideoEditSourceTime } from './time'

const sourceRemainder = z.object({ numerator: z.number().int().min(0).max(999_999), denominator: z.number().int().min(1).max(1_000_000) }).strict().refine(value => value.numerator < value.denominator, '源时刻余量必须小于一微秒。')
const value = z.union([z.number().finite(), z.boolean(), z.string().max(4096), z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)])])
export const codeMaterialKeyframeSchema = z.object({
  id: z.string().min(1).max(100), sourceInUs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), sourceRemainder,
  value, interpolation: z.enum(['linear', 'hold', 'ease']),
}).strict()
export const codeMaterialCurvesSchema = z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), z.array(codeMaterialKeyframeSchema).min(1).max(256)).superRefine((curves, context) => {
  if (Object.keys(curves).length > 32 || Object.values(curves).reduce((count, points) => count + points.length, 0) > 2048) context.addIssue({ code: 'custom', message: '实例曲线最多32项及2048个关键帧，每项最多256个。' })
  const ids = Object.values(curves).flat().map(point => point.id)
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: '实例关键帧标识不能重复。' })
})
export type CodeMaterialKeyframe = z.infer<typeof codeMaterialKeyframeSchema>
export type CodeMaterialCurves = z.infer<typeof codeMaterialCurvesSchema>
interface PreparedCurve { declaration: CodeParameterDeclaration; points: CodeMaterialKeyframe[] }
export interface PreparedCodeMaterialParameters { values: CodeParameterValues; curves: ReadonlyMap<string, PreparedCurve> }

function rational(time: VideoEditSourceTime): { numerator: bigint; denominator: bigint } {
  if (!Number.isSafeInteger(time.sourceInUs) || time.sourceInUs < 0 || !Number.isInteger(time.sourceRemainder.numerator) || !Number.isInteger(time.sourceRemainder.denominator) || time.sourceRemainder.denominator < 1 || time.sourceRemainder.denominator > 1_000_000 || time.sourceRemainder.numerator < 0 || time.sourceRemainder.numerator >= time.sourceRemainder.denominator) throw new CodeMaterialError('CONTEXT', '关键帧需要有效的连续源时刻。')
  const denominator = BigInt(time.sourceRemainder.denominator)
  return { numerator: BigInt(time.sourceInUs) * denominator + BigInt(time.sourceRemainder.numerator), denominator }
}
export function compareCodeMaterialTime(left: VideoEditSourceTime, right: VideoEditSourceTime): number {
  const a = rational(left); const b = rational(right); const delta = a.numerator * b.denominator - b.numerator * a.denominator
  return delta < 0n ? -1 : delta > 0n ? 1 : 0
}
function intervalFraction(time: VideoEditSourceTime, left: VideoEditSourceTime, right: VideoEditSourceTime): number {
  const a = rational(time); const b = rational(left); const c = rational(right)
  const numerator = (a.numerator * b.denominator - b.numerator * a.denominator) * c.denominator
  const denominator = (c.numerator * b.denominator - b.numerator * c.denominator) * a.denominator
  return Number(numerator) / Number(denominator)
}
/** Curves are source-anchored. Prepare once per immutable instance/document;
 * playback only binary-searches points and interpolates bounded values. */
export function prepareCodeMaterialParameters(program: CodeMaterialMetadata, instance: Pick<CodeMaterialInstance, 'parameters' | 'curves'>): PreparedCodeMaterialParameters {
  const values = validateCodeMaterialParameters(program, instance.parameters)
  const curves = new Map<string, PreparedCurve>()
  for (const [key, raw] of Object.entries(codeMaterialCurvesSchema.parse(instance.curves ?? {}))) {
    const declaration = program.parameters.find(parameter => parameter.key === key)
    if (!declaration || declaration.type === 'image' || !declaration.animatable) throw new CodeMaterialError('PARAMETERS', `参数 ${key} 不支持关键帧。`)
    const points = raw.map(point => ({ ...point, value: validateCodeMaterialParameterValue(declaration, point.value) as CodeMaterialKeyframe['value'] })).sort(compareCodeMaterialTime)
    for (let index = 0; index < points.length; index++) {
      const point = points[index]
      if (index && compareCodeMaterialTime(points[index - 1], point) === 0) throw new CodeMaterialError('PARAMETERS', `参数 ${key} 在同一源时刻有重复关键帧。`)
      if (declaration.type !== 'number' && declaration.type !== 'color' && point.interpolation !== 'hold') throw new CodeMaterialError('PARAMETERS', `参数 ${key} 只能使用保持插值。`)
      const seconds = (point.sourceInUs + point.sourceRemainder.numerator / point.sourceRemainder.denominator) / 1e6
      if (program.mode === 'dynamic' && seconds > program.durationSeconds && seconds - program.durationSeconds > 4 * Number.EPSILON * Math.max(1, seconds, program.durationSeconds)) throw new CodeMaterialError('PARAMETERS', `参数 ${key} 的关键帧超出源码声明时长。`)
    }
    curves.set(key, { declaration, points })
  }
  return { values, curves }
}
function interpolate(left: CodeParameterValue, right: CodeParameterValue, amount: number): CodeParameterValue {
  if (typeof left === 'number' && typeof right === 'number') return left + (right - left) * amount
  if (Array.isArray(left) && Array.isArray(right)) return left.map((channel, index) => channel + (right[index] - channel) * amount) as CodeColor
  return left
}
export function evaluateCodeMaterialParameters(prepared: PreparedCodeMaterialParameters, time: VideoEditSourceTime): CodeParameterValues {
  rational(time)
  const values = { ...prepared.values }
  for (const [key, { points }] of prepared.curves) {
    if (compareCodeMaterialTime(time, points[0]) <= 0) { values[key] = structuredClone(points[0].value); continue }
    if (compareCodeMaterialTime(time, points.at(-1)!) >= 0) { values[key] = structuredClone(points.at(-1)!.value); continue }
    let low = 0; let high = points.length - 1
    while (high - low > 1) { const middle = (low + high) >> 1; if (compareCodeMaterialTime(points[middle], time) <= 0) low = middle; else high = middle }
    const left = points[low]; const right = points[high]
    const fraction = intervalFraction(time, left, right)
    const amount = left.interpolation === 'ease' ? fraction * fraction * (3 - 2 * fraction) : fraction
    values[key] = left.interpolation === 'hold' ? structuredClone(left.value) : interpolate(left.value, right.value, amount)
  }
  return values
}

export interface CodeMaterialMigrationImpact { key: string; title: string; reason: string; resetValue: boolean; removeCurve: boolean }
/** Build an explicit proposal. The caller must show impacts before publishing;
 * existing valid values/curves survive even when declaration ranges narrow. */
export function proposeCodeMaterialMigration(previous: CodeMaterialMetadata, next: CodeMaterialMetadata, instance: CodeMaterialInstance, versionId: string): { instance: CodeMaterialInstance; impacts: CodeMaterialMigrationImpact[] } {
  prepareCodeMaterialParameters(previous, instance)
  const parameters = validateCodeMaterialParameters(previous, instance.parameters)
  const curves = structuredClone(instance.curves ?? {})
  const impacts: CodeMaterialMigrationImpact[] = []
  for (const old of previous.parameters) {
    const current = next.parameters.find(parameter => parameter.key === old.key)
    let reason = ''; let resetValue = false; let removeCurve = false
    if (!current) { reason = '参数已删除'; resetValue = true; removeCurve = Boolean(curves[old.key]); delete parameters[old.key]; delete curves[old.key] }
    else {
      if (current.type !== old.type) reason = '参数类型已改变'
      else if (old.type === 'number' && current.type === 'number' && (current.min > old.min || current.max < old.max)) reason = '数值范围缩小'
      else if (old.type === 'choice' && current.type === 'choice' && old.options.some(option => !current.options.includes(option))) reason = '部分选项已删除'
      else if (old.type === 'text' && current.type === 'text' && current.maxLength < old.maxLength) reason = '文字上限缩小'
      try { parameters[old.key] = validateCodeMaterialParameterValue(current, parameters[old.key]) } catch { parameters[old.key] = structuredClone(current.default); resetValue = true }
    }
    if (reason || resetValue || removeCurve) impacts.push({ key: old.key, title: old.title, reason: reason || '实例值不再适用', resetValue, removeCurve })
  }
  const nextValues = validateCodeMaterialParameters(next, parameters)
  for (const [key, points] of Object.entries(curves)) {
    try { prepareCodeMaterialParameters(next, { ...instance, parameters: nextValues, curves: { [key]: points } }) }
    catch {
      delete curves[key]
      const impact = impacts.find(impact => impact.key === key)
      if (impact) { impact.removeCurve = true; impact.reason ||= '已有关键帧不再适用' }
      else impacts.push({ key, title: previous.parameters.find(parameter => parameter.key === key)!.title, reason: '已有关键帧不再适用', resetValue: false, removeCurve: true })
    }
  }
  const result = { ...instance, versionId, parameters: nextValues, ...(Object.keys(curves).length ? { curves } : {}) }
  if (!Object.keys(curves).length) delete result.curves
  prepareCodeMaterialParameters(next, result)
  return { instance: result, impacts }
}
