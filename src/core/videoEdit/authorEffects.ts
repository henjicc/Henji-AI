import { normalizeVideoEditBuiltinParams, requireVideoEditBuiltinEffect, type VideoEditBuiltinParams } from './builtinEffects'
import { resolveVideoEditStylePieceEffects, videoEditStylePieceKnobValues, type VideoEditEffectPreset } from './effectPresets'
import { retiredBlurParams } from './blur'
import { evaluateVideoEditEffect } from './keyframes'
import type { ColorLutAsset } from './colorLutAsset'
import type { LayerEffectReference } from './layerEffectGeometry'
import { renderFingerprintHash } from './renderFingerprint'
import type { VideoEditComposition, VideoEditClip } from './document'

export interface AuthorEffectEnvironment { presets?: readonly VideoEditEffectPreset[]; luts?: readonly ColorLutAsset[]; boundStyle?: { id: string; name?: string; presets?: readonly VideoEditEffectPreset[] } }
/** 每个序列只取所绑定的工程风格副本；嵌套序列重新选择，不能继承父序列的口味。 */
export function authorEffectEnvironmentForStyle(environment: AuthorEffectEnvironment, styles: readonly { id: string; name?: string; effectPresets?: readonly VideoEditEffectPreset[] }[] = [], styleId?: string): AuthorEffectEnvironment {
  const style = styles.find(style => style.id === styleId)
  return { ...environment, boundStyle: style ? { id: style.id, name: style.name, presets: style.effectPresets } : styleId ? { id: styleId } : undefined }
}
/** 模板代码的口味跟随所属风格；无所属风格的模板使用全局库，普通片段沿用序列风格。 */
export function authorEffectEnvironmentForClip(document: Pick<VideoEditComposition, 'authorEffects' | 'styles' | 'templates' | 'colorLuts'>, clip: Pick<VideoEditClip, 'code' | 'templateId'>): AuthorEffectEnvironment {
  const template = document.templates?.find(template => template.body.kind === 'code' ? template.body.definitionId === clip.code?.definitionId : template.id === clip.templateId)
  const environment = { ...document.authorEffects, luts: document.colorLuts }
  if (!template) return environment
  if (template.style && !document.styles?.some(style => style.id === template.style!.id)) throw new Error(`模板所属风格（${template.style.id}）已不可用，请恢复工程风格副本或重新指定模板所属风格。`)
  return authorEffectEnvironmentForStyle(environment, document.styles, template.style?.id)
}
export interface ResolvedAuthorEffect {
  id: string
  params: VideoEditBuiltinParams
  amount: number
  source: 'descriptor' | 'look' | 'pose.blur'
  look?: string
}
function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error(`${field} 必须是普通对象。`)
  return value as Record<string, unknown>
}
export function resolveVideoEditLookByName(name: string, environment: AuthorEffectEnvironment): VideoEditEffectPreset {
  const candidates = (environment.presets ?? []).filter(preset => preset.name === name)
  const scoped = (environment.boundStyle?.presets ?? []).filter(preset => preset.name === name)
  const matches = scoped.length ? scoped : candidates
  if (!matches.length) throw new Error(`找不到风格件「${name}」。当前绑定风格：${environment.boundStyle ? `「${environment.boundStyle.name ?? environment.boundStyle.id}」（${environment.boundStyle.id}）` : '无'}；可用名称：${[...new Set([...(environment.presets ?? []), ...(environment.boundStyle?.presets ?? [])].map(preset => preset.name))].map(name => `「${name}」`).join('、') || '无'}。请读取 video_edit.project_style.effect_presets；工程副本较旧时可重新 bind_video_edit_style，或导入全局风格件。`)
  if (matches.length !== 1) throw new Error(`风格件「${name}」在${scoped.length ? '绑定风格' : '全局库'}中重名：${matches.map(preset => preset.id).join('、')}。请先改名消除歧义。`)
  return matches[0]
}
// 风格件修订替换快照对象；结构只展开一次，动画旋钮不进入缓存键。
const lookEffects = new WeakMap<VideoEditEffectPreset, VideoEditEffectPreset['effects']>()
function cachedLookEffects(preset: VideoEditEffectPreset): VideoEditEffectPreset['effects'] {
  let effects = lookEffects.get(preset)
  if (!effects) {
    effects = resolveVideoEditStylePieceEffects(preset)
    lookEffects.set(preset, effects)
  }
  return effects
}
export function resolveAuthorEffects(value: unknown, environment: AuthorEffectEnvironment = {}, presetFrame = 0, layer = '图层'): ResolvedAuthorEffect[] {
  if (!Array.isArray(value)) throw new Error(`${layer}.effects(t) 必须同步返回效果数组。`)
  const result: ResolvedAuthorEffect[] = []
  const add = (requested: string, raw: Record<string, unknown>, amount: number, look?: string): void => {
    // 冻结作者库的旧模糊描述与存档使用同一换算。
    const retired = retiredBlurParams(requested, raw)
    const id = retired ? 'blur' : requested, input = retired ?? raw
    const definition = requireVideoEditBuiltinEffect(id)
    if (definition.space !== 'layer' || definition.media === 'audio') throw new Error(`${id} 不能用于图层，请使用片段效果链。`)
    const params = normalizeVideoEditBuiltinParams(id, input)
    for (const param of definition.params) if (param.type === 'lut' && params[param.key] && !environment.luts?.some(lut => lut.id === params[param.key])) throw new Error(`项目中找不到 LUT ${params[param.key]}，请重新导入。`)
    if (amount > 0) result.push({ id, params, amount, source: look === undefined ? 'descriptor' : 'look', ...(look === undefined ? {} : { look }) })
  }
  value.forEach((raw: unknown, index) => {
    try {
      const descriptor = object(raw, '描述')
      const unknown = Object.keys(descriptor).filter(key => key !== 'id' && key !== 'params')
      if (unknown.length) throw new Error(`描述只接受 id、params；多传的键：${unknown.join('、')}。`)
      if (typeof descriptor.id !== 'string') throw new Error('id 必须是效果名称。')
      const params = descriptor.params === undefined ? {} : object(descriptor.params, 'params')
      if (descriptor.id !== 'look') { add(descriptor.id, params, 1); return }
      const unknownLook = Object.keys(params).filter(key => key !== 'name' && key !== 'knobs')
      if (unknownLook.length) throw new Error(`look 只接受 name 与 knobs；多传的键：${unknownLook.join('、')}。`)
      if (typeof params.name !== 'string' || !params.name.trim()) throw new Error('look 只接受非空 name 与 knobs。')
      const preset = resolveVideoEditLookByName(params.name, environment)
      const knobs = params.knobs === undefined ? {} : object(params.knobs, 'knobs')
      if (Object.values(knobs).some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('旋钮必须是有限数值。')
      if (preset.media !== 'video') throw new Error('声音预设不能用于图层。')
      const overrides = videoEditStylePieceKnobValues(preset, knobs as Record<string, number>)
      for (const item of cachedLookEffects(preset)) {
        if (!item.builtin || item.mask) throw new Error(`预设「${preset.name}」包含代码效果或蒙版，请使用片段效果链。`)
        const evaluated = evaluateVideoEditEffect(item, presetFrame)
        // 停用条目仍校验空间，避免启用曲线后才暴露无效预设。
        add(evaluated.builtin!.id, { ...evaluated.builtin!.params, ...overrides.get(item.id) }, evaluated.enabled === false ? 0 : evaluated.amount, preset.name)
      }
    } catch (cause) { throw new Error(`${layer}.effects[${index}]：${cause instanceof Error ? cause.message : String(cause)}`, { cause }) }
  })
  return result
}
export function authorEffectBleed(effects: readonly ResolvedAuthorEffect[], reference: LayerEffectReference): number {
  const value = effects.reduce((sum, effect) => {
    const pad = sum * reference.referenceSize.height
    const expanded = { ...reference, contentBounds: { ...reference.contentBounds, width: reference.contentBounds.width + pad * 2, height: reference.contentBounds.height + pad * 2 } }
    return sum + (requireVideoEditBuiltinEffect(effect.id).bleed?.(effect.params, expanded) ?? 0)
  }, 0)
  if (!Number.isFinite(value) || value < 0) throw new Error('图层效果外扩超出有限纹理尺寸。')
  return value
}
export function authorEffectsFingerprint(effects: readonly ResolvedAuthorEffect[], environment: AuthorEffectEnvironment = {}): string {
  return renderFingerprintHash(JSON.stringify(effects.map(effect => {
    const params = Object.entries(effect.params).sort(([a], [b]) => a.localeCompare(b))
    const luts = requireVideoEditBuiltinEffect(effect.id).params.filter(param => param.type === 'lut').map(param => environment.luts?.find(lut => lut.id === effect.params[param.key])?.contentIdentity)
    return [effect.id, params, effect.amount, luts]
  })))
}
