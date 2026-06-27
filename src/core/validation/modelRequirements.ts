import { registry } from '@/core/ModelRegistry'
import type { GenerationRequirement, RequirementMessage } from '@/core/types'
import { resolveInputLimits } from '@/core/inputs/inputLimits'
import { evaluateCondition } from './conditionEvaluator'

export interface GenerationInputs {
  prompt: string
  imagesCount: number
  videosCount: number
}

export interface RequirementValidationResult {
  ok: boolean
  message?: RequirementMessage
  requirementId?: string
}

const isCountSatisfied = (
  count: number,
  requirement?: { min?: number; max?: number; exact?: number }
): boolean => {
  if (!requirement) return true
  if (requirement.exact !== undefined) return count === requirement.exact
  if (requirement.min !== undefined && count < requirement.min) return false
  if (requirement.max !== undefined && count > requirement.max) return false
  return true
}

const normalizeParams = (params: DynamicValueMap, inputs: GenerationInputs): DynamicValueMap => {
  return {
    ...params,
    prompt: inputs.prompt,
    imagesCount: inputs.imagesCount,
    videosCount: inputs.videosCount,
    hasImage: inputs.imagesCount > 0,
    hasVideo: inputs.videosCount > 0
  }
}

const getRequirements = (modelId: string): GenerationRequirement[] => {
  const model = registry.getModel(modelId)
  return model?.requirements || []
}

export function validateGenerationRequirements(
  modelId: string,
  params: DynamicValueMap,
  inputs: GenerationInputs
): RequirementValidationResult {
  const requirements = getRequirements(modelId)
  const paramsWithDefaults = {
    ...registry.getDefaultValues(modelId),
    ...params
  }

  const normalized = normalizeParams(paramsWithDefaults, inputs)
  const context = {
    imagesCount: inputs.imagesCount,
    videosCount: inputs.videosCount,
    hasImage: inputs.imagesCount > 0,
    hasVideo: inputs.videosCount > 0
  }

  for (const requirement of requirements) {
    const matches = evaluateCondition(
      requirement.when,
      normalized as DynamicValueMap,
      context
    )

    if (!matches) continue

    const needs = requirement.require

    if (needs?.prompt && !inputs.prompt.trim()) {
      return {
        ok: false,
        message: requirement.message,
        requirementId: requirement.id
      }
    }

    if (needs?.images && !isCountSatisfied(inputs.imagesCount, needs.images)) {
      return {
        ok: false,
        message: requirement.message,
        requirementId: requirement.id
      }
    }

    if (needs?.videos && !isCountSatisfied(inputs.videosCount, needs.videos)) {
      return {
        ok: false,
        message: requirement.message,
        requirementId: requirement.id
      }
    }
  }

  const limits = resolveInputLimits(
    modelId,
    paramsWithDefaults,
    { imagesCount: inputs.imagesCount, videosCount: inputs.videosCount }
  )

  if (inputs.imagesCount < limits.images.min) {
    return {
      ok: false,
      message: {
        title: '图片数量不足',
        message: `至少需要上传${limits.images.min}张图片`,
        type: 'warning'
      },
      requirementId: 'input-limits-images-min'
    }
  }

  if (inputs.imagesCount > limits.images.max) {
    return {
      ok: false,
      message: {
        title: '图片数量超限',
        message: `最多只能上传${limits.images.max}张图片`,
        type: 'warning'
      },
      requirementId: 'input-limits-images-max'
    }
  }

  if (inputs.videosCount < limits.videos.min) {
    return {
      ok: false,
      message: {
        title: '视频数量不足',
        message: `至少需要上传${limits.videos.min}个视频`,
        type: 'warning'
      },
      requirementId: 'input-limits-videos-min'
    }
  }

  if (inputs.videosCount > limits.videos.max) {
    return {
      ok: false,
      message: {
        title: '视频数量超限',
        message: `最多只能上传${limits.videos.max}个视频`,
        type: 'warning'
      },
      requirementId: 'input-limits-videos-max'
    }
  }

  return { ok: true }
}
