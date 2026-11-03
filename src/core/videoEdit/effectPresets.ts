import { z } from 'zod'
import { renderFingerprintHash } from './renderFingerprint'
import { videoEditEffectSchema, videoEditEffectMedia } from './compositing'
import { requireVideoEditBuiltinEffect } from './builtinEffects'
import { videoEditStyleCodeSnapshotSchema, styleCodeParameters } from './styleCodeSnapshot'
import { prepareCodeMaterialParameters } from './codeMaterialAnimation'
import type { ContentTrustReference } from '../contentTrust'
import { isCodeImageReference, isCodeAudioReference, isCodeSceneReference } from './codeMaterial/contract'

const point = z.object({ input: z.number().finite(), output: z.number().finite() }).strict()
export const videoEditStyleKnobMappingSchema = z.object({
  effectId: z.string().min(1), parameter: z.string().min(1),
  points: z.array(point).min(2),
}).strict().superRefine((mapping, context) => {
  if (mapping.points.some((value, index) => index > 0 && value.input <= mapping.points[index - 1].input)) context.addIssue({ code: 'custom', message: '映射控制点的输入值必须递增。' })
})
export const videoEditStyleKnobSchema = z.object({
  key: z.string().min(1), name: z.string().trim().min(1), min: z.number().finite(), max: z.number().finite(), default: z.number().finite(),
  mappings: z.array(videoEditStyleKnobMappingSchema).min(1),
}).strict().superRefine((knob, context) => {
  if (knob.min >= knob.max || knob.default < knob.min || knob.default > knob.max) context.addIssue({ code: 'custom', message: '旋钮范围与默认值无效。' })
  for (const mapping of knob.mappings) if (mapping.points.length < 2 || mapping.points[0].input !== knob.min || mapping.points.at(-1)!.input !== knob.max) context.addIssue({ code: 'custom', message: '映射必须覆盖旋钮的整个范围；两个控制点为线性映射，更多控制点为分段线性映射。' })
})

/** Shared by the local effect library and the preset exchange file. */
export const videoEditEffectPresetNameSchema = z.string().trim().min(1, '请填写预设名称。').max(200, '预设名称最多 200 字。')
export const videoEditEffectPresetSchema = z.object({
  id: z.string().min(1).max(100), name: videoEditEffectPresetNameSchema, media: z.enum(['video', 'audio']),
  effects: z.array(videoEditEffectSchema).min(1),
  description: z.string().optional(), usage: z.string().optional(),
  knobs: z.array(videoEditStyleKnobSchema).optional(),
  codeSnapshots: z.record(z.string(), videoEditStyleCodeSnapshotSchema).optional(),
}).strict().superRefine((preset, context) => {
  if (preset.effects.some(effect => videoEditEffectMedia(effect) !== preset.media || effect.mask?.regionId === 'tracker' || effect.mask?.regionId === 'shapes' && effect.mask.shapes.some(shape => shape.follow))) context.addIssue({ code: 'custom', message: '预设只保存同媒介的效果，不能保存原片段的跟踪绑定。' })
  for (const key of Object.keys(preset.codeSnapshots ?? {})) if (!preset.effects.some(effect => effect.id === key && effect.code)) context.addIssue({ code: 'custom', message: '代码快照必须对应风格件里的代码滤镜成员。' })
  for (const effect of preset.effects) if (effect.code) {
    const snapshot = preset.codeSnapshots?.[effect.id]
    if (!snapshot || snapshot.version.id !== effect.code.versionId) context.addIssue({ code: 'custom', message: '代码滤镜成员必须带完整的固定版本快照。' })
    else try { prepareCodeMaterialParameters({ name: effect.name, kind: 'filter', mode: 'dynamic', seed: 0, parameters: styleCodeParameters(snapshot) }, effect.code) } catch (error) { context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) }) }
    if (Object.values(effect.code.parameters).some(value => isCodeImageReference(value) && value.kind === 'clip')) context.addIssue({ code: 'custom', message: '风格件不携带对时间线片段的引用，这类参数须为空。' })
    if (snapshot) for (const value of Object.values(effect.code.parameters)) {
      if ((isCodeAudioReference(value) || isCodeImageReference(value) && (value.kind === 'image' || value.kind === 'video')) && !snapshot.media?.some(media => media.id === value.mediaId && (value.kind === 'audio' ? media.kind === 'audio' || media.kind === 'video' : media.kind === value.kind))) context.addIssue({ code: 'custom', message: '代码滤镜快照缺少匹配的媒体依赖。' })
      if (isCodeSceneReference(value) && !snapshot.scenes?.some(scene => scene.id === value.sceneId)) context.addIssue({ code: 'custom', message: '代码滤镜快照缺少引用的片子数据。' })
    }
  }
  const ids = new Set(preset.effects.map(effect => effect.id))
  if (preset.knobs?.length && ids.size !== preset.effects.length) context.addIssue({ code: 'custom', message: '带旋钮的风格件内，效果标识不能重复。' })
  const keys = new Set<string>(), targets = new Set<string>()
  for (const knob of preset.knobs ?? []) {
    if (keys.has(knob.key)) context.addIssue({ code: 'custom', message: `旋钮 ${knob.key} 重复。` })
    keys.add(knob.key)
    for (const mapping of knob.mappings) {
      if (!ids.has(mapping.effectId)) context.addIssue({ code: 'custom', message: `旋钮引用了不存在的效果 ${mapping.effectId}。` })
      const effect = preset.effects.find(effect => effect.id === mapping.effectId)
      const parameter = effect?.builtin ? requireVideoEditBuiltinEffect(effect.builtin.id).params.find(param => param.key === mapping.parameter) : effect?.code && preset.codeSnapshots?.[effect.id] ? styleCodeParameters(preset.codeSnapshots[effect.id]).find(param => param.key === mapping.parameter) : undefined
      if (!parameter || parameter.type !== 'number' && parameter.type !== 'angle') context.addIssue({ code: 'custom', message: `映射目标 ${mapping.effectId}.${mapping.parameter} 必须是已登记的数值参数。` })
      else if (mapping.points.some(point => point.output < parameter.min || point.output > parameter.max)) context.addIssue({ code: 'custom', message: `${mapping.parameter} 映射值必须在 ${parameter.min}–${parameter.max} 之间。` })
      const target = JSON.stringify([mapping.effectId, mapping.parameter])
      if (targets.has(target)) context.addIssue({ code: 'custom', message: '一个效果参数只能由一个旋钮映射一次。' })
      targets.add(target)
    }
  }
  // 旧读者忽略旋钮后仍按相同参数出画面；只在全部映射合法后归一化解析副本。
  if (!context.issues.length && preset.knobs?.length) preset.effects = resolveVideoEditStylePieceEffects(preset)
})
export type VideoEditEffectPreset = z.infer<typeof videoEditEffectPresetSchema>
const presetFingerprints = new WeakMap<readonly VideoEditEffectPreset[], string>()
/** 风格件数组是不可变修订；摘要不受风格名称、说明书或样片设置影响。 */
export function videoEditStylePiecesFingerprint(presets: readonly VideoEditEffectPreset[] | undefined): string {
  if (!presets?.length) return ''
  let fingerprint = presetFingerprints.get(presets)
  if (fingerprint === undefined) { fingerprint = renderFingerprintHash(JSON.stringify(presets)); presetFingerprints.set(presets, fingerprint) }
  return fingerprint
}
export { VIDEO_EDIT_EFFECT_LIBRARY_VERSION } from '../persistence/schemaVersions'
export function assertVideoEditStylePieceNames(presets: readonly VideoEditEffectPreset[], previous: readonly VideoEditEffectPreset[] = []): void {
  const counts = new Map<string, number>(), conflicts = new Set<string>()
  const existing = new Map(previous.map(preset => [preset.id, preset.name]))
  for (const preset of presets) counts.set(preset.name, (counts.get(preset.name) ?? 0) + 1)
  // 历史重名允许逐项改名、删除或收藏；只有引入重名的新条目或名称变化才拒绝。
  for (const preset of presets) if (counts.get(preset.name)! > 1 && existing.get(preset.id) !== preset.name) conflicts.add(preset.name)
  if (conflicts.size) throw new Error(`风格件名称重复：${[...conflicts].map(name => `「${name}」`).join('、')}。请使用不同名称。`)
}
export const videoEditEffectLibrarySchema = z.object({ favorites: z.array(z.string()), presets: z.array(videoEditEffectPresetSchema) }).strict().superRefine((value, context) => {
  if (new Set(value.presets.map(preset => preset.id)).size !== value.presets.length) context.addIssue({ code: 'custom', message: '全局效果库只保存标识唯一的全局风格件。' })
})

/** 旧预设的效果与曲线原样保留，新增风格语义为空。 */
export function migrateVideoEditStylePiece(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  return { description: '', usage: '', knobs: [], ...structuredClone(value) }
}

/** 先求原效果曲线，再以旋钮映射覆盖所指参数；不改动风格件原件。 */
export function videoEditStylePieceKnobValues(preset: VideoEditEffectPreset, values: Readonly<Record<string, number>> = {}): Map<string, Record<string, number>> {
  const knobs = preset.knobs ?? []
  for (const key of Object.keys(values)) if (!knobs.some(knob => knob.key === key)) throw new Error(`风格件「${preset.name}」没有旋钮 ${key}；可用：${knobs.map(knob => knob.key).join('、') || '无'}。`)
  const result = new Map<string, Record<string, number>>()
  for (const knob of knobs) {
    const value = Object.hasOwn(values, knob.key) ? values[knob.key] : knob.default
    if (!Number.isFinite(value) || value < knob.min || value > knob.max) throw new Error(`旋钮 ${knob.key} 必须在 ${knob.min}–${knob.max} 之间。`)
    for (const mapping of knob.mappings) {
      const upper = mapping.points.findIndex((point, index) => index > 0 && point.input >= value)
      const a = mapping.points[upper - 1], b = mapping.points[upper]
      const output = a.output + (b.output - a.output) * ((value - a.input) / (b.input - a.input))
      result.set(mapping.effectId, { ...result.get(mapping.effectId), [mapping.parameter]: output })
    }
  }
  return result
}

/** 作者、片段应用和预览使用同一份旋钮展开；映射参数由旋钮控制，其他参数的曲线继续保留。 */
export function resolveVideoEditStylePieceEffects(preset: VideoEditEffectPreset, values: Readonly<Record<string, number>> = {}): VideoEditEffectPreset['effects'] {
  const overrides = videoEditStylePieceKnobValues(preset, values)
  return preset.effects.map(effect => {
    const copy = structuredClone(effect), params = overrides.get(effect.id)
    if (copy.builtin && params) {
      copy.builtin.params = { ...copy.builtin.params, ...params }
      if (copy.builtin.curves) {
        copy.builtin.curves = Object.fromEntries(Object.entries(copy.builtin.curves).filter(([key]) => !Object.hasOwn(params, key)))
        if (!Object.keys(copy.builtin.curves).length) delete copy.builtin.curves
      }
    }
    if (copy.code && params) {
      copy.code.parameters = { ...copy.code.parameters, ...params }
      if (copy.code.curves) {
        copy.code.curves = Object.fromEntries(Object.entries(copy.code.curves).filter(([key]) => !Object.hasOwn(params, key)))
        if (!Object.keys(copy.code.curves).length) delete copy.code.curves
      }
    }
    return videoEditEffectSchema.parse(copy)
  })
}

/** 导入边界覆盖包内来源，包里的字段不能赋予本机信任。 */
export function markVideoEditStylePieceForeign(preset: VideoEditEffectPreset, foreign: ContentTrustReference): VideoEditEffectPreset {
  return videoEditEffectPresetSchema.parse({ ...preset, ...(preset.codeSnapshots ? { codeSnapshots: Object.fromEntries(Object.entries(preset.codeSnapshots).map(([id, snapshot]) => [id, { ...snapshot, version: { ...snapshot.version, foreign } }])) } : {}) })
}
