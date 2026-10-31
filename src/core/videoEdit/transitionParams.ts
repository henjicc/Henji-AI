/**
 * 人与助手共用的过渡参数入口：目录项按方式显隐，播放先求值动画，再映射回来源参数。
 * 来源的数值、单位与默认值保持原契约；没有参数的混合过渡与音频过渡返回空表。
 */
import { describeVideoEditParams, normalizeVideoEditParamSet, type VideoEditBuiltinParams } from './builtinEffects'
import type { VideoEditBuiltinParam } from './builtinEffects'
import type { VideoEditTransitionKind } from './transitions'
import { VIDEO_EDIT_SOURCE_TRANSITION_KINDS, VIDEO_EDIT_SOURCE_TRANSITION_PARAMS } from './transitionSources'
import { CURATED_TRANSITION_PARAMS, isRemovedVideoEditTransition } from './transitionCatalog'
import { evaluateVideoEditKeyframes, videoEditKeyframeValues, videoEditCurvesSchema, type VideoEditCurves } from './keyframes'

export const VIDEO_EDIT_BUILTIN_TRANSITION_KINDS = VIDEO_EDIT_SOURCE_TRANSITION_KINDS
export type VideoEditBuiltinTransitionKind = typeof VIDEO_EDIT_BUILTIN_TRANSITION_KINDS[number]
export const VIDEO_EDIT_TRANSITION_PARAMS = VIDEO_EDIT_SOURCE_TRANSITION_PARAMS

export function isVideoEditBuiltinTransitionKind(kind: VideoEditTransitionKind | string): kind is VideoEditBuiltinTransitionKind {
  return (VIDEO_EDIT_BUILTIN_TRANSITION_KINDS as readonly string[]).includes(kind)
}
/** 这种过渡的参数登记；交叉溶解、黑场、白场与音频过渡没有参数。 */
export function videoEditTransitionParamDefinitions(kind: VideoEditTransitionKind): readonly VideoEditBuiltinParam[] {
  return isRemovedVideoEditTransition(kind) ? [] : CURATED_TRANSITION_PARAMS.get(kind) ?? (isVideoEditBuiltinTransitionKind(kind) ? VIDEO_EDIT_TRANSITION_PARAMS[kind] : [])
}
/** Transition-local frames use the same tracks as clip/effect animation. */
export function evaluateVideoEditTransitionParams(transition: { kind: VideoEditTransitionKind; parameters?: Readonly<Record<string, unknown>>; frameCurves?: VideoEditCurves }, time: number): VideoEditBuiltinParams {
  const values = resolveVideoEditTransitionParams(transition.kind, transition.parameters)
  for (const param of videoEditTransitionParamDefinitions(transition.kind)) values[param.key] = evaluateVideoEditKeyframes(transition.frameCurves?.[param.key], time, values[param.key])
  // Overshooting tangents are allowed; parameter bounds still apply at consumption.
  return normalizeVideoEditTransitionParams(transition.kind, transition.kind, values, undefined, true)
}

export function assertVideoEditTransitionCurves(transition: { kind: VideoEditTransitionKind; durationFrames: number; frameCurves?: VideoEditCurves }): void {
  const definitions = videoEditTransitionParamDefinitions(transition.kind)
  for (const [key, points] of Object.entries(videoEditCurvesSchema.parse(transition.frameCurves ?? {}))) {
    const parameter = definitions.find(param => param.key === key)
    if (!parameter) throw new Error(`转场参数 ${key} 不存在；可用：${definitions.map(param => param.key).join('、') || '无可动画参数'}。`)
    if (parameter.animatable === false) throw new Error(`转场参数 ${key} 不支持关键帧。`)
    if (!points.length) throw new Error(`转场参数 ${key} 的关键帧不能为空；关闭动画请省略这个参数。`)
    for (const point of points) {
      if (point.time >= transition.durationFrames) throw new Error(`转场参数 ${key} 的 time 越界：允许转场内 0–${transition.durationFrames - 1} 帧。`)
      for (const value of videoEditKeyframeValues(point)) validateVideoEditTransitionParams(transition.kind, transition.kind, { [key]: value })
      if (['boolean', 'enum', 'curve', 'lut'].includes(parameter.type) && point.interpolation !== 'hold') throw new Error(`转场参数 ${key} 只能使用 hold 定格插值。`)
    }
  }
}
/** 合并并校验（界面拖动 `clamp` 时数值夹进范围，助手写入越界直接报错）；返回完整参数表。 */
export function normalizeVideoEditTransitionParams(kind: VideoEditTransitionKind, name: string, changes: Readonly<Record<string, unknown>> = {}, base?: Readonly<Record<string, unknown>>, clamp = false): VideoEditBuiltinParams {
  return normalizeVideoEditParamSet(`过渡“${name}”`, videoEditTransitionParamDefinitions(kind), changes, base, clamp)
}
/** 只校验给出的键、不补默认值（助手整体写入：写什么存什么）。 */
export function validateVideoEditTransitionParams(kind: VideoEditTransitionKind, name: string, params: Readonly<Record<string, unknown>>): VideoEditBuiltinParams {
  const full = normalizeVideoEditTransitionParams(kind, name, params)
  return Object.fromEntries(Object.keys(params).map(key => [key, full[key]]))
}
/** 渲染用：补齐默认值（不校验）。 */
export function resolveVideoEditTransitionParams(kind: VideoEditTransitionKind, params: Readonly<Record<string, unknown>> | undefined): VideoEditBuiltinParams {
  return Object.fromEntries(videoEditTransitionParamDefinitions(kind).map(param => [param.key, (params?.[param.key] ?? param.default) as VideoEditBuiltinParams[string]]))
}
/** 文档校验：未知参数、越界或错类型返回原因。 */
export function videoEditTransitionParamsIssue(kind: VideoEditTransitionKind, name: string, params: Readonly<Record<string, unknown>> | undefined): string | undefined {
  if (!params) return undefined
  try { normalizeVideoEditTransitionParams(kind, name, params); return undefined } catch (error) { return error instanceof Error ? error.message : '过渡参数无效。' }
}
export function describeVideoEditTransitionParams(kind: VideoEditTransitionKind): ReturnType<typeof describeVideoEditParams> { return describeVideoEditParams(videoEditTransitionParamDefinitions(kind)) }
