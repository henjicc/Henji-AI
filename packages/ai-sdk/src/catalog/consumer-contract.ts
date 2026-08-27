import type {
  ModelRuntimeDefinition,
  RuntimeInputCountLimit,
  RuntimeInputLimitsConfig,
  RuntimeMediaFieldConstraint,
  RuntimeMediaFieldKind,
  RuntimeParamDef,
  RuntimeVideoConstraints,
} from '../types/model'
import type { JsonObject } from '../types/runtime'
import { evaluateRuntimeCondition } from './conditions'

export interface ResolvedRuntimeInputCountLimit {
  min: number
  max?: number
}

export interface ResolvedRuntimeInputLimits {
  images?: ResolvedRuntimeInputCountLimit
  videos?: ResolvedRuntimeInputCountLimit
  audios?: ResolvedRuntimeInputCountLimit
  videoConstraints?: RuntimeVideoConstraints
}

export interface RuntimeGenericMediaInput {
  source: 'input-limits'
  id: 'uploadedFilePaths' | 'uploadedVideoFilePaths' | 'uploadedAudioFilePaths'
  kind: 'image' | 'video' | 'audio'
  valueKeys: readonly string[]
  limit: ResolvedRuntimeInputCountLimit
}

export interface RuntimeParamMediaInput {
  source: 'param'
  id: string
  kind: RuntimeMediaFieldKind
  param: RuntimeParamDef
}

export interface RuntimeMediaInputContract {
  genericInputs: RuntimeGenericMediaInput[]
  paramInputs: RuntimeParamMediaInput[]
  /** 请求构建后的特殊字段声明；由上传预处理层消费，不等同于表单参数 ID。 */
  runtimeFields: RuntimeMediaFieldConstraint[]
}

const GENERIC_MEDIA_INPUTS: ReadonlyArray<{
  id: RuntimeGenericMediaInput['id']
  kind: RuntimeGenericMediaInput['kind']
  valueKeys: readonly string[]
  limitKey: 'images' | 'videos' | 'audios'
}> = [
  {
    id: 'uploadedFilePaths',
    kind: 'image',
    valueKeys: ['uploadedFilePaths', 'images', 'uploadedImages'],
    limitKey: 'images',
  },
  {
    id: 'uploadedVideoFilePaths',
    kind: 'video',
    valueKeys: ['uploadedVideoFilePaths', 'videos', 'uploadedVideos'],
    limitKey: 'videos',
  },
  {
    id: 'uploadedAudioFilePaths',
    kind: 'audio',
    valueKeys: ['uploadedAudioFilePaths', 'audios', 'uploadedAudios'],
    limitKey: 'audios',
  },
]

/**
 * 解析函数型/数据型 inputLimits，并执行匹配的规则。
 * 未声明的媒体种类保持 undefined；消费方不能自行补成 URL 文本框。
 */
export function resolveRuntimeInputLimits(
  model: ModelRuntimeDefinition,
  params: JsonObject,
  context: JsonObject = {}
): ResolvedRuntimeInputLimits {
  const config = resolveInputLimitsConfig(model, params)
  const resolved: ResolvedRuntimeInputLimits = {
    images: normalizeLimit(config.images),
    videos: normalizeLimit(config.videos),
    audios: normalizeLimit(config.audios),
  }

  for (const rule of config.rules ?? []) {
    if (!evaluateRuntimeCondition(rule.when, params, context)) continue
    resolved.images = mergeLimit(resolved.images, rule.images)
    resolved.videos = mergeLimit(resolved.videos, rule.videos)
    resolved.audios = mergeLimit(resolved.audios, rule.audios)
    if (rule.videoConstraints) resolved.videoConstraints = { ...rule.videoConstraints }
  }

  return resolved
}

/**
 * 返回消费方应渲染的上传控件契约。
 *
 * 通用图片/视频/音频入口来自 inputLimits；mask/PDF/角色图等特殊入口来自参数 type；
 * runtimeConstraints.mediaFields 单独保留为请求体字段声明。三者不靠 URL 字段名猜测，
 * 也不提供手动 URL fallback。
 */
export function getRuntimeMediaInputContract(
  model: ModelRuntimeDefinition,
  params: JsonObject,
  context: JsonObject = {}
): RuntimeMediaInputContract {
  const limits = resolveRuntimeInputLimits(model, params, context)
  const genericInputs: RuntimeGenericMediaInput[] = []
  for (const input of GENERIC_MEDIA_INPUTS) {
    const limit = limits[input.limitKey]
    if (!limit || (limit.max === 0 && limit.min === 0)) continue
    genericInputs.push({
      source: 'input-limits',
      id: input.id,
      kind: input.kind,
      valueKeys: input.valueKeys,
      limit,
    })
  }

  return {
    genericInputs,
    paramInputs: flattenRuntimeParams(model.params)
      .filter(isMediaParam)
      .map((param) => ({
        source: 'param',
        id: param.id,
        kind: mediaKindForParam(param),
        param,
      })),
    runtimeFields: (model.runtimeConstraints?.mediaFields ?? []).map((field) => ({ ...field })),
  }
}

export function flattenRuntimeParams(params: readonly RuntimeParamDef[]): RuntimeParamDef[] {
  const flattened: RuntimeParamDef[] = []
  for (const param of params) {
    flattened.push(param)
    if (param.type === 'panel') flattened.push(...flattenRuntimeParams(param.children))
  }
  return flattened
}

function resolveInputLimitsConfig(
  model: ModelRuntimeDefinition,
  params: JsonObject
): RuntimeInputLimitsConfig {
  if (!model.inputLimits) return {}
  return typeof model.inputLimits === 'function' ? model.inputLimits(params) : model.inputLimits
}

function normalizeLimit(limit: RuntimeInputCountLimit | undefined): ResolvedRuntimeInputCountLimit | undefined {
  if (!limit) return undefined
  if (limit.exact !== undefined) return { min: limit.exact, max: limit.exact }
  return { min: limit.min ?? 0, ...(limit.max !== undefined ? { max: limit.max } : {}) }
}

function mergeLimit(
  base: ResolvedRuntimeInputCountLimit | undefined,
  override: RuntimeInputCountLimit | undefined
): ResolvedRuntimeInputCountLimit | undefined {
  if (!override) return base
  if (override.exact !== undefined) return { min: override.exact, max: override.exact }
  return {
    min: override.min ?? base?.min ?? 0,
    ...(override.max !== undefined
      ? { max: override.max }
      : base?.max !== undefined
        ? { max: base.max }
        : {}),
  }
}

function isMediaParam(param: RuntimeParamDef): boolean {
  return param.type === 'image-upload' || param.type === 'video-upload' || param.type === 'file-upload'
}

function mediaKindForParam(param: RuntimeParamDef): RuntimeMediaFieldKind {
  if (param.type === 'image-upload') return 'image'
  if (param.type === 'video-upload') return 'video'
  return 'file'
}
