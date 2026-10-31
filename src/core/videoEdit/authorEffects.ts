import { normalizeVideoEditBuiltinParams, requireVideoEditBuiltinEffect, type VideoEditBuiltinParams } from './builtinEffects'
import { retiredBlurParams } from './blur'
import type { VideoEditEffectPreset } from './effectPresets'
import { evaluateVideoEditEffect } from './keyframes'
import type { ColorLutAsset } from './colorLutAsset'
import type { LayerEffectReference } from './layerEffectGeometry'
import { renderFingerprintHash } from './renderFingerprint'

export interface AuthorEffectEnvironment { presets?: readonly VideoEditEffectPreset[]; luts?: readonly ColorLutAsset[] }
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
  const matches = (environment.presets ?? []).filter(preset => preset.name === name)
  if (!matches.length) throw new Error(`找不到全局效果预设「${name}」，请导入预设或直接写效果描述。`)
  if (matches.length !== 1) throw new Error(`全局效果预设「${name}」重名：${matches.map(preset => preset.id).join('、')}。请先改名消除歧义。`)
  return matches[0]
}
export function resolveAuthorEffects(value: unknown, environment: AuthorEffectEnvironment = {}, presetFrame = 0, layer = '图层'): ResolvedAuthorEffect[] {
  if (!Array.isArray(value)) throw new Error(`${layer}.effects(t) 必须同步返回效果数组。`)
  const result: ResolvedAuthorEffect[] = []
  const add = (requested: string, raw: Record<string, unknown>, amount: number, look?: string): void => {
    // 冻结的 henji-effects 1.0.0 的 blur() 与旧预设产出并进“模糊”前的 ID，按存档迁移的同一换算转过来。
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
      if (Object.keys(descriptor).some(key => key !== 'id' && key !== 'params')) throw new Error('描述只接受 id、params。')
      if (typeof descriptor.id !== 'string') throw new Error('id 必须是效果名称。')
      const params = descriptor.params === undefined ? {} : object(descriptor.params, 'params')
      if (descriptor.id !== 'look') { add(descriptor.id, params, 1); return }
      if (typeof params.name !== 'string' || !params.name.trim() || Object.keys(params).some(key => key !== 'name')) throw new Error('look 只接受非空 name；本版本不支持旋钮。')
      const preset = resolveVideoEditLookByName(params.name, environment)
      if (preset.media !== 'video') throw new Error('声音预设不能用于图层。')
      for (const item of preset.effects) {
        if (!item.builtin || item.mask) throw new Error(`预设「${preset.name}」包含代码效果或蒙版，请使用片段效果链。`)
        const evaluated = evaluateVideoEditEffect(item, presetFrame)
        // 停用条目仍校验空间，避免启用曲线后才暴露无效预设。
        add(evaluated.builtin!.id, evaluated.builtin!.params, evaluated.enabled === false ? 0 : evaluated.amount, preset.name)
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
