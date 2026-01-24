import { registry } from '@/core/ModelRegistry'
import type { InputCountLimit, InputLimits, InputLimitsConfig, InputLimitRule, VideoConstraints } from '@/core/types'
import { evaluateCondition } from '@/core/validation/conditionEvaluator'

export interface ResolvedInputLimits {
  images: { min: number; max: number }
  videos: { min: number; max: number }
  videoConstraints?: VideoConstraints
}

export interface InputLimitContext {
  imagesCount?: number
  videosCount?: number
  [key: string]: unknown
}

const DEFAULT_IMAGE_MAX = 6
const DEFAULT_VIDEO_MAX = 0

const normalizeLimit = (limit: InputCountLimit | undefined, fallbackMax: number): { min: number; max: number } => {
  if (!limit) return { min: 0, max: fallbackMax }
  if (limit.exact !== undefined) return { min: limit.exact, max: limit.exact }
  return {
    min: limit.min ?? 0,
    max: limit.max ?? fallbackMax
  }
}

const mergeLimit = (base: { min: number; max: number }, override?: InputCountLimit): { min: number; max: number } => {
  if (!override) return base
  if (override.exact !== undefined) return { min: override.exact, max: override.exact }
  return {
    min: override.min ?? base.min,
    max: override.max ?? base.max
  }
}

const resolveConfig = (inputLimits: InputLimits | undefined, params: Record<string, unknown>): InputLimitsConfig => {
  if (!inputLimits) return {}
  if (typeof inputLimits === 'function') {
    return inputLimits(params)
  }
  return inputLimits
}

const resolveRules = (
  rules: InputLimitRule[] | undefined,
  params: Record<string, unknown>,
  context: InputLimitContext
): Array<{ rule: InputLimitRule; matches: boolean }> => {
  if (!rules || rules.length === 0) return []
  return rules.map(rule => ({
    rule,
    matches: evaluateCondition(rule.when, params as Record<string, any>, context)
  }))
}

export function resolveInputLimits(
  modelId: string,
  params: Record<string, unknown>,
  context: InputLimitContext = {}
): ResolvedInputLimits {
  const model = registry.getModel(modelId)
  const config = resolveConfig(model?.inputLimits, params)

  let images = normalizeLimit(config.images, DEFAULT_IMAGE_MAX)
  let videos = normalizeLimit(config.videos, DEFAULT_VIDEO_MAX)
  let videoConstraints: VideoConstraints | undefined

  const rules = resolveRules(config.rules, params, context)

  for (const { rule, matches } of rules) {
    if (!matches) continue
    images = mergeLimit(images, rule.images)
    videos = mergeLimit(videos, rule.videos)
    if (rule.videoConstraints) {
      videoConstraints = rule.videoConstraints
    }
  }

  return { images, videos, videoConstraints }
}
