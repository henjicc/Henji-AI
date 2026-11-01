import { CODE_AUTHOR_API_VERSION, CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION, CODE_AUTHOR_EFFECT_KEYS_MIN_API_VERSION, CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION } from './codeAuthorVersions'
import { normalizeVideoEditBuiltinParams, requireVideoEditBuiltinEffect, videoEditBuiltinEffect, videoEditBuiltinParamSpaceIssue, type VideoEditBuiltinParams, type VideoEditBuiltinEffectDefinition } from './builtinEffects'
import { codeElementEffectKeySchema, evaluateCodeElementEffectValues, readCodeElementOverride, type CodeElementEffectOverride, type CodeElementOverride, type CodeElementOverrides, type EvaluatedCodeElementOverride } from './codeElementOverrides'
import { jsonEqual } from '../jsonEqual'
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
  key?: string
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
export function resolveVideoEditLookByName(name: string, environment: AuthorEffectEnvironment, space: 'layer' | 'frame' = 'layer', apiVersion = CODE_AUTHOR_API_VERSION): VideoEditEffectPreset {
  const candidates = (environment.presets ?? []).filter(preset => preset.name === name)
  const scoped = (environment.boundStyle?.presets ?? []).filter(preset => preset.name === name)
  const matches = scoped.length ? scoped : candidates
  if (!matches.length) throw new Error(`找不到风格件「${name}」。当前绑定风格：${environment.boundStyle ? `「${environment.boundStyle.name ?? environment.boundStyle.id}」（${environment.boundStyle.id}）` : '无'}；可用名称：${[...new Set([...(environment.presets ?? []), ...(environment.boundStyle?.presets ?? [])].map(preset => preset.name))].map(name => `「${name}」`).join('、') || '无'}。请读取 video_edit.project_style.effect_presets；工程副本较旧时可重新 bind_video_edit_style，或导入全局风格件。`)
  if (matches.length !== 1) throw new Error(`风格件「${name}」在${scoped.length ? '绑定风格' : '全局库'}中重名：${matches.map(preset => preset.id).join('、')}。请先改名消除歧义。`)
  validateVideoEditLook(matches[0], space, apiVersion)
  return matches[0]
}
function assertAuthorEffectSpace(definition: VideoEditBuiltinEffectDefinition, space: 'layer' | 'frame', apiVersion: number): void {
  if (definition.space === 'frame' && space === 'layer') throw new Error(apiVersion < CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION
    ? `${definition.name}按整幅画面算，请使用片段效果链；升级作者接口至 v${CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION} 后可用调整层 adjust。`
    : `${definition.name}按整幅画面算，请放进调整层 adjust。`)
  if (!['layer', ...(space === 'frame' ? ['frame'] : [])].includes(definition.space ?? '') || definition.media === 'audio') throw new Error(`${definition.id} 不能用于${space === 'frame' ? '调整层' : '图层'}，请使用片段效果链。`)
}
/**
 * 在名称解析期校验整个风格件，不依赖当前帧、启用状态或动画求值后的参数。风格件里不属于当前空间的参数
 * （片段、整帧专用）在这里不报错，取用时略过，见 `lookParams`。
 */
export function validateVideoEditLook(preset: VideoEditEffectPreset, space: 'layer' | 'frame' = 'layer', apiVersion = CODE_AUTHOR_API_VERSION): void {
  if (preset.media !== 'video') throw new Error('声音预设不能用于图层。')
  for (const effect of preset.effects) {
    if (!effect.builtin || effect.mask) throw new Error(`预设「${preset.name}」包含代码效果或蒙版，请使用片段效果链。`)
    const retired = retiredBlurParams(effect.builtin.id, effect.builtin.params)
    assertAuthorEffectSpace(requireVideoEditBuiltinEffect(retired ? 'blur' : effect.builtin.id), space, apiVersion)
  }
}
/**
 * 风格件来自片段效果链，存的是完整参数表（含曲线与旋钮目标）：用在图层或调整层时，只取当前空间里起作用的参数，
 * 片段、整帧专用的参数在这里本来就没有意义（变形的边缘在图层上恒为透明）。作者代码显式写这类参数仍按空间严格报错。
 */
function lookParams(id: string, params: Readonly<Record<string, unknown>>, space: 'layer' | 'frame'): Record<string, unknown> {
  const retired = retiredBlurParams(id, params)
  const definition = requireVideoEditBuiltinEffect(retired ? 'blur' : id)
  return Object.fromEntries(Object.entries(params).filter(([key]) => !videoEditBuiltinParamSpaceIssue(definition.params.find(param => param.key === key), space)))
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
/** 代码给出的一项效果：风格件按名称算一项，成员按同一 key 归组。 */
export interface AuthorCodeEffect {
  key: string
  id: string
  name?: string
  codeValues: VideoEditBuiltinParams
  /** 缺省时由 id 与代码值重新求出（界面在下一帧渲染完成前用已观察到的代码值叠加覆盖）。 */
  effects?: readonly ResolvedAuthorEffect[]
}
function resolveAuthorCodeEffects(value: unknown, environment: AuthorEffectEnvironment, presetFrame: number, layer: string, space: 'layer' | 'frame', apiVersion: number): AuthorCodeEffect[] {
  const field = space === 'frame' ? 'adjust' : 'effects'
  if (!Array.isArray(value)) throw new Error(`${layer}.${field}(t) 必须同步返回效果数组。`)
  const result: AuthorCodeEffect[] = []
  const keys = new Set<string>(), counts = new Map<string, number>()
  // 自动 key 让开本元素所有显式 key，结果与书写顺序无关。
  const explicit = new Set(value.flatMap(raw => raw && typeof raw === 'object' && typeof (raw as { key?: unknown }).key === 'string' ? [(raw as { key: string }).key] : []))
  value.forEach((raw: unknown, index) => {
    try {
      const descriptor = object(raw, '描述')
      const keyed = apiVersion >= CODE_AUTHOR_EFFECT_KEYS_MIN_API_VERSION
      const unknown = Object.keys(descriptor).filter(key => key !== 'id' && key !== 'params' && !(key === 'key' && keyed))
      if (unknown.length) throw new Error(`描述只接受 id、params${keyed ? '、key' : ''}；多传的键：${unknown.join('、')}。`)
      if (typeof descriptor.id !== 'string') throw new Error('id 必须是效果名称。')
      const params = descriptor.params === undefined ? {} : object(descriptor.params, 'params')
      if (descriptor.key !== undefined && !codeElementEffectKeySchema.safeParse(descriptor.key).success) throw new Error('key 必须是非空文字，且不能是 __proto__。')
      const base = descriptor.id === 'look' ? `look:${String(params.name)}` : descriptor.id
      let key = descriptor.key as string | undefined
      if (key === undefined) {
        // 自动 key 按出现顺序编号，遇到已占用的名字顺延，旧代码不会因风格件名里带 #N 而报错。
        let count = (counts.get(base) ?? 0) + 1
        key = count === 1 ? base : `${base}#${count}`
        while (keys.has(key) || explicit.has(key)) key = `${base}#${++count}`
        counts.set(base, count)
      } else if (keys.has(key)) throw new Error(`效果 key「${key}」在同一元素里重复，请换一个 key。`)
      keys.add(key)
      const effects: ResolvedAuthorEffect[] = []
      const add = (requested: string, input: Record<string, unknown>, amount: number, look?: string): void => {
        // 冻结作者库的旧模糊描述与存档使用同一换算。
        const retired = retiredBlurParams(requested, input)
        const id = retired ? 'blur' : requested
        const definition = requireVideoEditBuiltinEffect(id)
        assertAuthorEffectSpace(definition, space, apiVersion)
        const normalized = normalizeVideoEditBuiltinParams(id, retired ?? input, undefined, false, space)
        for (const param of definition.params) if (param.type === 'lut' && normalized[param.key] && !environment.luts?.some(lut => lut.id === normalized[param.key])) throw new Error(`项目中找不到 LUT ${normalized[param.key]}，请重新导入。`)
        if (amount > 0) effects.push({ key, id, params: normalized, amount, source: look === undefined ? 'descriptor' : 'look', ...(look === undefined ? {} : { look }) })
      }
      if (descriptor.id !== 'look') {
        add(descriptor.id, params, 1)
        result.push({ key, id: effects[0].id, codeValues: effects[0].params, effects })
        return
      }
      const unknownLook = Object.keys(params).filter(key => key !== 'name' && key !== 'knobs')
      if (unknownLook.length) throw new Error(`look 只接受 name 与 knobs；多传的键：${unknownLook.join('、')}。`)
      if (typeof params.name !== 'string' || !params.name.trim()) throw new Error('look 只接受非空 name 与 knobs。')
      const preset = resolveVideoEditLookByName(params.name, environment, space, apiVersion)
      const knobs = params.knobs === undefined ? {} : object(params.knobs, 'knobs')
      if (Object.values(knobs).some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('旋钮必须是有限数值。')
      const overrides = videoEditStylePieceKnobValues(preset, knobs as Record<string, number>)
      for (const item of cachedLookEffects(preset)) {
        const evaluated = evaluateVideoEditEffect(item, presetFrame)
        // 停用条目仍校验空间，避免启用曲线后才暴露无效预设。
        add(evaluated.builtin!.id, lookParams(evaluated.builtin!.id, { ...evaluated.builtin!.params, ...overrides.get(item.id) }, space), evaluated.enabled === false ? 0 : evaluated.amount, preset.name)
      }
      result.push({ key, id: 'look', name: params.name, codeValues: Object.fromEntries((preset.knobs ?? []).map(knob => [knob.key, Object.hasOwn(knobs, knob.key) ? knobs[knob.key] as number : knob.default])), effects })
    } catch (cause) { throw new Error(`${layer}.${field}[${index}]：${cause instanceof Error ? cause.message : String(cause)}`, { cause }) }
  })
  return result
}
export function resolveAuthorEffects(value: unknown, environment: AuthorEffectEnvironment = {}, presetFrame = 0, layer = '图层', space: 'layer' | 'frame' = 'layer', apiVersion = CODE_AUTHOR_API_VERSION): ResolvedAuthorEffect[] {
  return resolveAuthorCodeEffects(value, environment, presetFrame, layer, space, apiVersion).flatMap(entry => entry.effects ?? [])
}

/**
 * 存档读取的容错：未知、不属于此空间或类型已不对的参数丢弃，越界按范围钳制。
 * 钳制后整组仍不合法（跨参数约束，如调色的起点大于终点）时返回空：调用方退回代码值或跳过这一项，不让旧覆盖拖垮整帧。
 */
function readElementEffectParams(id: string, raw: Readonly<Record<string, unknown>>, space: 'layer' | 'frame'): VideoEditBuiltinParams | undefined {
  const definition = requireVideoEditBuiltinEffect(id)
  const known = Object.fromEntries(Object.entries(raw).filter(([key, value]) => {
    if (!definition.params.some(param => param.key === key && !videoEditBuiltinParamSpaceIssue(param, space))) return false
    try { normalizeVideoEditBuiltinParams(id, { [key]: value }, undefined, true, space); return true } catch { return false }
  }))
  try { return normalizeVideoEditBuiltinParams(id, known, undefined, true, space) } catch { return undefined }
}
/**
 * 追加效果的实际 key：源码后来用了追加项已占的 key 时，追加项按 `<效果 ID>+N` 换成不冲突的 key，代码那一项保留原 key。
 * 读取、渲染与写入用同一规则；经元素写入时换过的 key 落盘，修改记录随之改名。
 */
export function codeElementAddedEffectKeys(codeKeys: ReadonlySet<string>, added: readonly { key: string; id: string }[]): string[] {
  const used = new Set([...codeKeys, ...added.map(effect => effect.key)])
  return added.map(effect => {
    if (!codeKeys.has(effect.key)) return effect.key
    let index = 1, key = `${effect.id}+${index}`
    while (used.has(key)) key = `${effect.id}+${++index}`
    used.add(key)
    return key
  })
}
function authorEffectSpaceAllowed(definition: VideoEditBuiltinEffectDefinition, space: 'layer' | 'frame', apiVersion: number): boolean {
  try { assertAuthorEffectSpace(definition, space, apiVersion); return true } catch { return false }
}

export interface AuthorElementEffectState {
  key: string
  /** 内置效果 ID；风格件为 look。代码里已没有的覆盖项为空。 */
  id: string
  name?: string
  codeValues: VideoEditBuiltinParams
  values: VideoEditBuiltinParams
  overridden: string[]
  added: boolean
  enabled: boolean
  missing: boolean
}
export interface AuthorElementEffects { effects: ResolvedAuthorEffect[]; states: AuthorElementEffectState[] }
/**
 * 按 key 把元素覆盖叠到代码效果上：先改值，再跳过停用项，最后接追加效果。风格件只按旋钮覆盖，成员仍是连续工序。
 * 读取按存档容错：代码已没有的 key、已移除或不适用于此图层的追加效果保留为 missing 并跳过，不让旧覆盖拖垮整帧。
 */
export function applyAuthorElementEffectOverride(code: readonly AuthorCodeEffect[], override: EvaluatedCodeElementOverride | undefined, environment: AuthorEffectEnvironment = {}, presetFrame = 0, layer = '图层', space: 'layer' | 'frame' = 'layer', apiVersion = CODE_AUTHOR_API_VERSION): AuthorElementEffects {
  const effects: ResolvedAuthorEffect[] = [], states: AuthorElementEffectState[] = []
  // 图层效果从作者接口 v7 起才进入渲染与指纹；更早的代码不叠加元素效果覆盖。
  const patches = apiVersion >= CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION ? override : undefined
  const keys = new Set(code.map(entry => entry.key))
  const look = (name: string, knobs: VideoEditBuiltinParams, key: string): ResolvedAuthorEffect[] => (resolveAuthorCodeEffects([{ id: 'look', params: { name, knobs } }], environment, presetFrame, layer, space, apiVersion)[0].effects ?? []).map(effect => ({ ...effect, key }))
  for (const entry of code) {
    const patch = patches?.effects && Object.hasOwn(patches.effects, entry.key) ? patches.effects[entry.key] : undefined
    let values = entry.codeValues, resolved = entry.effects, overridden: string[] = []
    if (entry.name !== undefined) {
      const knobs = resolveVideoEditLookByName(entry.name, environment, space, apiVersion).knobs ?? []
      const changed = knobs.filter(knob => typeof patch?.values?.[knob.key] === 'number')
      if (changed.length) {
        const next = { ...values, ...Object.fromEntries(changed.map(knob => [knob.key, Math.min(knob.max, Math.max(knob.min, patch!.values![knob.key] as number))])) }
        // 旋钮映射出的成员参数组合非法时退回代码值。
        try { resolved = look(entry.name, next, entry.key); values = next; overridden = changed.map(knob => knob.key) } catch { /* 退回代码值 */ }
      }
      resolved ??= look(entry.name, values, entry.key)
    } else {
      const merged = patch?.values ? readElementEffectParams(entry.id, { ...entry.codeValues, ...patch.values }, space) : undefined
      if (merged) {
        values = merged
        overridden = Object.keys(patch!.values!).filter(key => Object.hasOwn(merged, key))
      }
      if (overridden.length || !resolved) resolved = [{ key: entry.key, id: entry.id, params: values, amount: 1, source: 'descriptor' }]
    }
    const enabled = patch?.enabled !== false
    states.push({ key: entry.key, id: entry.id, ...(entry.name === undefined ? {} : { name: entry.name }), codeValues: entry.codeValues, values, overridden, enabled, added: false, missing: false })
    if (enabled) effects.push(...resolved)
  }
  const addedKeys = codeElementAddedEffectKeys(keys, patches?.addedEffects ?? [])
  for (const [index, added] of (patches?.addedEffects ?? []).entries()) {
    const key = addedKeys[index]
    const definition = videoEditBuiltinEffect(added.id)
    // 已移除、不适用于此图层或整组参数不合法的追加效果保留为 missing 并跳过。
    const params = definition && authorEffectSpaceAllowed(definition, space, apiVersion) ? readElementEffectParams(added.id, added.params, space) : undefined
    if (!params) { states.push({ key, id: added.id, codeValues: {}, values: added.params, overridden: [], enabled: false, added: true, missing: true }); continue }
    effects.push({ key, id: added.id, params, amount: 1, source: 'descriptor' })
    states.push({ key, id: added.id, codeValues: {}, values: params, overridden: Object.keys(added.params).filter(param => Object.hasOwn(params, param)), enabled: true, added: true, missing: false })
  }
  for (const [key, patch] of Object.entries(patches?.effects ?? {})) if (!keys.has(key)) states.push({ key, id: '', codeValues: {}, values: patch.values ?? {}, overridden: Object.keys(patch.values ?? {}), enabled: patch.enabled !== false, added: false, missing: true })
  return { effects, states }
}
/** 渲染、指纹与读回共用的入口：代码效果求值后叠加元素覆盖。 */
export function resolveAuthorElementEffects(value: unknown, override: EvaluatedCodeElementOverride | undefined, environment: AuthorEffectEnvironment = {}, presetFrame = 0, layer = '图层', space: 'layer' | 'frame' = 'layer', apiVersion = CODE_AUTHOR_API_VERSION): AuthorElementEffects {
  return applyAuthorElementEffectOverride(resolveAuthorCodeEffects(value, environment, presetFrame, layer, space, apiVersion), override, environment, presetFrame, layer, space, apiVersion)
}

type AuthorEffectCurves = NonNullable<CodeElementEffectOverride['curves']>
/**
 * 一项效果实际会出现的整组值：没有曲线时是静态值，有曲线时取每个关键帧时刻的值。
 * 线性与保持插值下两条曲线的大小关系只在关键帧时刻翻转；缓动、贝塞尔会在段内弯折，相邻时刻之间再均匀取样。
 */
function effectValueGroups(values: Record<string, string | number | boolean>, curves: AuthorEffectCurves | undefined): Array<Record<string, string | number | boolean>> {
  const points = Object.values(curves ?? {}).flat()
  if (!points.length) return [values]
  const at = (point: { sourceInUs: number; sourceRemainder: { numerator: number; denominator: number } }): number => point.sourceInUs + point.sourceRemainder.numerator / point.sourceRemainder.denominator
  const times = [...new Set(points.map(at))].sort((a, b) => a - b)
  const curved = points.some(point => point.interpolation === 'ease' || point.interpolation === 'bezier')
  const samples = curved ? times.slice(1).flatMap((end, index) => Array.from({ length: 15 }, (_, step) => times[index] + (end - times[index]) * (step + 1) / 16)) : []
  const time = (us: number) => ({ sourceInUs: Math.floor(us), sourceRemainder: { numerator: Math.round((us - Math.floor(us)) * 1e6) % 1e6, denominator: 1e6 } })
  return [...points, ...samples.map(time)].map(point => evaluateCodeElementEffectValues(values, curves, point))
}
/**
 * 写入不用存档读取的钳制：代码值叠上覆盖后按整组校验（含跨参数约束），静态值与每个关键帧时刻都检查；追加效果必须适用于此图层且 key 不与代码效果重名。
 * `states` 是当前帧观察到的代码效果与本次保留的追加效果；没有观察时（素材项、代码资产）只校验与代码效果列表无关的部分，`space` 未知时追加效果在图层或调整层任一可用即可。
 */
export function validateAuthorElementEffectOverrides(value: Pick<CodeElementOverride, 'effects' | 'addedEffects'>, states: readonly AuthorElementEffectState[] | undefined, environment: AuthorEffectEnvironment, space: 'layer' | 'frame' | undefined, apiVersion = CODE_AUTHOR_API_VERSION, existingAddedKeys: ReadonlySet<string> = new Set(), requireLuts = true): void {
  if (apiVersion < CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION && (Object.keys(value.effects ?? {}).length || value.addedEffects?.length)) throw new Error(`此代码使用作者接口 v${apiVersion}，图层效果从 v${CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION} 起可用；请先升级代码素材。`)
  // 代码效果可被覆盖，代码效果与保留的追加效果都占用 key。
  const code = states?.filter(state => !state.added && !state.missing) ?? []
  const keys = new Set(states?.filter(state => !state.missing).map(state => state.key))
  const spaces: Array<'layer' | 'frame'> = space ? [space] : ['layer', 'frame']
  const validate = (state: Pick<AuthorElementEffectState, 'id' | 'name' | 'key'>, codeValues: VideoEditBuiltinParams, values: Record<string, string | number | boolean>, curves?: AuthorEffectCurves): void => {
    if (state.name !== undefined) {
      const lookSpace = space ?? 'layer'
      const knobs = resolveVideoEditLookByName(state.name, environment, lookSpace, apiVersion).knobs ?? []
      const knob = (key: string, raw: unknown): void => {
        const declared = knobs.find(knob => knob.key === key)
        if (!declared || typeof raw !== 'number' || !Number.isFinite(raw) || raw < declared.min || raw > declared.max) throw new Error(`风格件「${state.name}」只接受已声明旋钮及其范围：${key}；可用旋钮：${knobs.map(knob => `${knob.key}（${knob.min}–${knob.max}）`).join('、') || '无'}。要改风格件里定好的效果参数，请修改风格件本身。`)
      }
      for (const [key, raw] of Object.entries(values)) knob(key, raw)
      for (const [key, points] of Object.entries(curves ?? {})) for (const point of points) knob(key, point.value)
      // 旋钮映射到成员参数后再整组校验，映射出的组合非法同样拒绝。
      for (const group of effectValueGroups({ ...codeValues, ...values }, curves)) resolveAuthorCodeEffects([{ id: 'look', params: { name: state.name, knobs: group } }], environment, 0, state.key, lookSpace, apiVersion)
      return
    }
    const definition = requireVideoEditBuiltinEffect(state.id)
    for (const [key, points] of Object.entries(curves ?? {})) {
      const param = definition.params.find(param => param.key === key)
      if (param && param.animatable === false) throw new Error(`${state.key}.${key} 不支持关键帧。`)
      if (param && param.type !== 'number' && param.type !== 'color' && points.some(point => point.interpolation !== 'hold')) throw new Error(`${state.key}.${key} 只支持保持插值。`)
    }
    let failure: unknown
    for (const candidate of spaces) {
      try {
        assertAuthorEffectSpace(definition, candidate, apiVersion)
        for (const group of effectValueGroups({ ...codeValues, ...values }, curves)) {
          const normalized = normalizeVideoEditBuiltinParams(state.id, group, undefined, false, candidate)
          if (requireLuts) for (const param of definition.params) if (param.type === 'lut' && normalized[param.key] && !environment.luts?.some(lut => lut.id === normalized[param.key])) throw new Error(`项目中找不到 LUT ${normalized[param.key]}，请先导入。`)
        }
        return
      } catch (cause) { failure ??= cause }
    }
    throw new Error(`效果「${state.key}」：${failure instanceof Error ? failure.message : String(failure)}`, { cause: failure })
  }
  if (states) for (const [key, patch] of Object.entries(value.effects ?? {})) {
    const state = code.find(state => state.key === key)
    if (!state) throw new Error(`代码里没有效果「${key}」；可用效果：${code.map(state => state.key).join('、') || '无'}。追加新效果请写 addedEffects，改追加效果请改它在 addedEffects 里的 params。`)
    validate(state, state.codeValues, patch.values ?? {}, patch.curves)
  }
  for (const added of value.addedEffects ?? []) {
    // 已有的追加效果只改参数时不查重名：源码后来用了同一个 key 时，读取把追加项换成不冲突的 key。
    if (keys.has(added.key) && !existingAddedKeys.has(added.key)) throw new Error(`效果 key「${added.key}」与代码效果或其他追加效果重名，请换一个 key。`)
    keys.add(added.key)
    validate({ key: added.key, id: added.id }, {}, added.params, added.curves)
  }
}
/**
 * 素材项与代码资产的元素覆盖还没有当前帧观察：只严格校验与代码效果列表无关的部分（作者接口版本、追加效果的整组参数、LUT 与关键帧），只查相对 `previous` 改动的项。
 * 代码效果的 key 与参数要放进片段、取到观察后由元素写入校验；读取时组合非法退回代码值。
 * `requireLuts` 只在用户或助手主动写入时打开：代码资产不带 LUT、工程里的 LUT 也可能事后删掉，导入与放进时间线时缺 LUT 按读取容错处理。
 */
export function validateCodeElementOverridesWithoutObservation(next: CodeElementOverrides | undefined, previous: CodeElementOverrides | undefined, environment: AuthorEffectEnvironment, apiVersion: number, requireLuts = true): void {
  for (const [elementId, value] of Object.entries(next ?? {})) {
    const before = readCodeElementOverride(previous, elementId)
    const effects = Object.fromEntries(Object.entries(value.effects ?? {}).filter(([key, patch]) => !(before?.effects && Object.hasOwn(before.effects, key) && jsonEqual(patch, before.effects[key]))))
    const addedEffects = value.addedEffects?.filter(effect => !jsonEqual(effect, before?.addedEffects?.find(item => item.key === effect.key)))
    try { validateAuthorElementEffectOverrides({ effects, addedEffects }, undefined, environment, undefined, apiVersion, new Set(), requireLuts) }
    catch (cause) { throw new Error(`元素「${elementId}」：${cause instanceof Error ? cause.message : String(cause)}`, { cause }) }
  }
}
export function authorEffectBleed(effects: readonly ResolvedAuthorEffect[], reference: LayerEffectReference): number {
  const value = effects.reduce((sum, effect) => {
    const pad = sum * reference.referenceSize.height
    const expanded = { ...reference, contentBounds: { ...reference.contentBounds, width: reference.contentBounds.width + pad * 2, height: reference.contentBounds.height + pad * 2 } }
    return sum + (requireVideoEditBuiltinEffect(effect.id).bleed?.(effect.params, expanded, pad) ?? 0)
  }, 0)
  if (!Number.isFinite(value) || value < 0) throw new Error('图层效果外扩超出有限纹理尺寸。')
  return value
}
/** `frame` 是效果时钟的帧位置；声明了 frameSeed 的效果把换算出的种子并入身份，各调用方必须传入渲染时用的同一个值。 */
export function authorEffectsFingerprint(effects: readonly ResolvedAuthorEffect[], environment: AuthorEffectEnvironment, frame: number): string {
  return renderFingerprintHash(JSON.stringify(effects.map(effect => {
    const params = Object.entries(effect.params).sort(([a], [b]) => a.localeCompare(b))
    const luts = requireVideoEditBuiltinEffect(effect.id).params.filter(param => param.type === 'lut').map(param => environment.luts?.find(lut => lut.id === effect.params[param.key])?.contentIdentity)
    const { frameSeed } = requireVideoEditBuiltinEffect(effect.id)
    return [effect.id, params, effect.amount, luts, ...(frameSeed ? [frameSeed(effect.params, frame)] : [])]
  })))
}
