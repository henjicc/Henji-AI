/**
 * 模型验证器
 *
 * 验证 ModelDefinition 配置的完整性和正确性
 */

import { ModelDefinition, ParamDef } from '../types'
import { hasGenerationModelDescription } from '../modelCatalog/generationModelDescriptions'
import { validateModelParamConventions } from './modelParamConventionValidator'
import { validateParamPresentation } from './paramPresentationValidator'

/**
 * 验证错误类
 */
export class ModelValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelValidationError'
  }
}

/**
 * 验证模型定义
 *
 * @param model - 模型定义
 * @throws {ModelValidationError} 如果验证失败
 */
export function validateModel(model: ModelDefinition): void {
  // 1. 验证元数据
  validateMeta(model)

  // 2. 验证参数定义
  validateParams(model)

  // 3. 验证参数展示编排
  validateParamPresentation(model, (message) => {
    throw new ModelValidationError(message)
  })

  // 4. 验证联动规则
  validateLinkages(model)

  // 5. 验证端点配置
  validateEndpoints(model)

  // 6. 验证价格配置
  validatePricing(model)
}

/**
 * 验证元数据
 */
function validateMeta(model: ModelDefinition): void {
  const { meta } = model

  // 检查必需字段
  if (!meta.id || typeof meta.id !== 'string') {
    throw new ModelValidationError('Model meta.id is required and must be a string')
  }

  if (!meta.canonicalModelId || typeof meta.canonicalModelId !== 'string') {
    throw new ModelValidationError('Model meta.canonicalModelId is required and must be a string')
  }

  if (!hasGenerationModelDescription(meta.canonicalModelId)) {
    throw new ModelValidationError(
      `Model meta.canonicalModelId is not registered in generationModelDescriptions: ${meta.canonicalModelId}`
    )
  }

  if (!meta.provider || typeof meta.provider !== 'string') {
    throw new ModelValidationError('Model meta.provider is required and must be a string')
  }

  if (!meta.type || !['image', 'video', 'audio'].includes(meta.type)) {
    throw new ModelValidationError('Model meta.type must be one of: image, video, audio')
  }

  if (!meta.name) {
    throw new ModelValidationError('Model meta.name is required')
  }

  // 验证 name 格式
  if (typeof meta.name !== 'string' && typeof meta.name !== 'object') {
    throw new ModelValidationError('Model meta.name must be a string or I18nText object')
  }

  if (typeof meta.name === 'object') {
    if ('key' in meta.name) {
      if (!meta.name.key || typeof meta.name.key !== 'string') {
        throw new ModelValidationError('Model meta.name.key must be a string')
      }
    } else if (!meta.name.zh && !meta.name.en) {
      throw new ModelValidationError('Model meta.name I18nText must have at least zh or en')
    }
  }

  // 验证别名（如果存在）
  if (meta.aliases) {
    if (!Array.isArray(meta.aliases)) {
      throw new ModelValidationError('Model meta.aliases must be an array')
    }

    meta.aliases.forEach((alias, index) => {
      if (typeof alias !== 'string') {
        throw new ModelValidationError(`Model meta.aliases[${index}] must be a string`)
      }
    })
  }

  // 验证标签（如果存在）
  if (meta.tags) {
    if (!Array.isArray(meta.tags)) {
      throw new ModelValidationError('Model meta.tags must be an array')
    }
  }

  // 验证轮询配置（如果存在）
  if (meta.polling) {
    if (typeof meta.polling.interval !== 'number' || meta.polling.interval <= 0) {
      throw new ModelValidationError('Model meta.polling.interval must be a positive number')
    }

    if (typeof meta.polling.maxAttempts !== 'number' || meta.polling.maxAttempts <= 0) {
      throw new ModelValidationError('Model meta.polling.maxAttempts must be a positive number')
    }
  }

  // Validate progress config (optional)
  if (meta.progress) {
    const progress = meta.progress

    if (progress.mode !== 'time' && progress.mode !== 'polling') {
      throw new ModelValidationError('Model meta.progress.mode must be time or polling')
    }

    if (progress.mode === 'time') {
      if (typeof progress.baseDurationMs !== 'number' || progress.baseDurationMs <= 0) {
        throw new ModelValidationError('Model meta.progress.baseDurationMs must be a positive number')
      }
      if (progress.perUnitMs !== undefined && (typeof progress.perUnitMs !== 'number' || progress.perUnitMs < 0)) {
        throw new ModelValidationError('Model meta.progress.perUnitMs must be a non-negative number')
      }
      if (progress.tickMs !== undefined && (typeof progress.tickMs !== 'number' || progress.tickMs <= 0)) {
        throw new ModelValidationError('Model meta.progress.tickMs must be a positive number')
      }
      if (progress.scaleWith !== undefined && typeof progress.scaleWith !== 'string') {
        throw new ModelValidationError('Model meta.progress.scaleWith must be a string')
      }
      if (progress.minDurationMs !== undefined && (typeof progress.minDurationMs !== 'number' || progress.minDurationMs <= 0)) {
        throw new ModelValidationError('Model meta.progress.minDurationMs must be a positive number')
      }
      if (progress.maxDurationMs !== undefined && (typeof progress.maxDurationMs !== 'number' || progress.maxDurationMs <= 0)) {
        throw new ModelValidationError('Model meta.progress.maxDurationMs must be a positive number')
      }
    }

    if (progress.mode === 'polling') {
      if (typeof progress.baseAttempts !== 'number' || progress.baseAttempts <= 0) {
        throw new ModelValidationError('Model meta.progress.baseAttempts must be a positive number')
      }
      if (progress.perUnitAttempts !== undefined && (typeof progress.perUnitAttempts !== 'number' || progress.perUnitAttempts < 0)) {
        throw new ModelValidationError('Model meta.progress.perUnitAttempts must be a non-negative number')
      }
      if (progress.intervalMs !== undefined && (typeof progress.intervalMs !== 'number' || progress.intervalMs <= 0)) {
        throw new ModelValidationError('Model meta.progress.intervalMs must be a positive number')
      }
      if (progress.tickMs !== undefined && (typeof progress.tickMs !== 'number' || progress.tickMs <= 0)) {
        throw new ModelValidationError('Model meta.progress.tickMs must be a positive number')
      }
      if (progress.scaleWith !== undefined && typeof progress.scaleWith !== 'string') {
        throw new ModelValidationError('Model meta.progress.scaleWith must be a string')
      }
      if (progress.minAttempts !== undefined && (typeof progress.minAttempts !== 'number' || progress.minAttempts <= 0)) {
        throw new ModelValidationError('Model meta.progress.minAttempts must be a positive number')
      }
      if (progress.maxAttempts !== undefined && (typeof progress.maxAttempts !== 'number' || progress.maxAttempts <= 0)) {
        throw new ModelValidationError('Model meta.progress.maxAttempts must be a positive number')
      }
      if (progress.minDurationMs !== undefined && (typeof progress.minDurationMs !== 'number' || progress.minDurationMs <= 0)) {
        throw new ModelValidationError('Model meta.progress.minDurationMs must be a positive number')
      }
      if (progress.maxDurationMs !== undefined && (typeof progress.maxDurationMs !== 'number' || progress.maxDurationMs <= 0)) {
        throw new ModelValidationError('Model meta.progress.maxDurationMs must be a positive number')
      }
    }

    if (progress.minDurationMs !== undefined && progress.maxDurationMs !== undefined && progress.minDurationMs > progress.maxDurationMs) {
      throw new ModelValidationError('Model meta.progress.minDurationMs must be <= maxDurationMs')
    }

    const curve = progress.curve
    if (curve) {
      if (curve.slowStart !== undefined && (typeof curve.slowStart !== 'number' || curve.slowStart <= 0 || curve.slowStart >= 100)) {
        throw new ModelValidationError('Model meta.progress.curve.slowStart must be between 0 and 100')
      }
      if (curve.slowEnd !== undefined && (typeof curve.slowEnd !== 'number' || curve.slowEnd <= 0 || curve.slowEnd >= 100)) {
        throw new ModelValidationError('Model meta.progress.curve.slowEnd must be between 0 and 100')
      }
      if (curve.cap !== undefined && (typeof curve.cap !== 'number' || curve.cap <= 0 || curve.cap >= 100)) {
        throw new ModelValidationError('Model meta.progress.curve.cap must be between 0 and 100')
      }
      if (curve.tailFactor !== undefined && (typeof curve.tailFactor !== 'number' || curve.tailFactor <= 0)) {
        throw new ModelValidationError('Model meta.progress.curve.tailFactor must be a positive number')
      }
      if (curve.slowStart !== undefined && curve.slowEnd !== undefined && curve.slowStart >= curve.slowEnd) {
        throw new ModelValidationError('Model meta.progress.curve.slowStart must be < slowEnd')
      }
      if (curve.slowEnd !== undefined && curve.cap !== undefined && curve.slowEnd >= curve.cap) {
        throw new ModelValidationError('Model meta.progress.curve.slowEnd must be < cap')
      }
    }
  }

  if (meta.progressLearning) {
    const { segments, enableTimeBuckets } = meta.progressLearning

    if (enableTimeBuckets !== undefined && typeof enableTimeBuckets !== 'boolean') {
      throw new ModelValidationError('Model meta.progressLearning.enableTimeBuckets must be a boolean')
    }

    if (segments !== undefined) {
      if (!Array.isArray(segments)) {
        throw new ModelValidationError('Model meta.progressLearning.segments must be an array')
      }

      segments.forEach((segment, index) => {
        if (!segment || typeof segment !== 'object') {
          throw new ModelValidationError(`Model meta.progressLearning.segments[${index}] must be an object`)
        }

        if (segment.kind === 'field') {
          if (typeof segment.field !== 'string' || segment.field.trim().length === 0) {
            throw new ModelValidationError(`Model meta.progressLearning.segments[${index}].field must be a non-empty string`)
          }
          return
        }

        if (segment.kind === 'textLength') {
          if (segment.field !== 'prompt' && segment.field !== 'text') {
            throw new ModelValidationError(`Model meta.progressLearning.segments[${index}].field must be prompt or text`)
          }
          if (!Array.isArray(segment.buckets) || segment.buckets.length === 0) {
            throw new ModelValidationError(`Model meta.progressLearning.segments[${index}].buckets must be a non-empty array`)
          }
          segment.buckets.forEach((bucket, bucketIndex) => {
            if (typeof bucket !== 'number' || !Number.isFinite(bucket) || bucket <= 0) {
              throw new ModelValidationError(`Model meta.progressLearning.segments[${index}].buckets[${bucketIndex}] must be a positive number`)
            }
          })
          return
        }

        throw new ModelValidationError(`Model meta.progressLearning.segments[${index}].kind must be field or textLength`)
      })
    }
  }
}

/**
 * 验证参数定义
 */
function validateParams(model: ModelDefinition): void {
  const { params } = model

  if (!Array.isArray(params)) {
    throw new ModelValidationError('Model params must be an array')
  }

  // 参数 ID 唯一性检查
  const paramIds = new Set<string>()

  params.forEach((param, index) => {
    validateParam(param, index)

    // 检查 ID 唯一性
    if (paramIds.has(param.id)) {
      throw new ModelValidationError(`Duplicate param ID: ${param.id}`)
    }
    paramIds.add(param.id)
  })

  validateModelParamConventions(model, (message) => {
    throw new ModelValidationError(message)
  })
}

/**
 * 验证单个参数定义
 */
function validateParam(param: ParamDef, index: number): void {
  const prefix = `Model params[${index}]`

  // 检查必需字段
  if (!param.id || typeof param.id !== 'string') {
    throw new ModelValidationError(`${prefix}.id is required and must be a string`)
  }

  if (!param.type) {
    throw new ModelValidationError(`${prefix}.type is required`)
  }

  const validTypes = [
    'text',
    'textarea',
    'number',
    'dropdown',
    'switch',
    'radio',
    'composite',
    'image-upload',
    'video-upload',
    'file-upload',
    'resolution',
    'aspect-ratio'
  ]

  if (!validTypes.includes(param.type)) {
    throw new ModelValidationError(
      `${prefix}.type must be one of: ${validTypes.join(', ')}`
    )
  }

  if (typeof param.order !== 'number') {
    throw new ModelValidationError(`${prefix}.order must be a number`)
  }

  // 接受 name 或 label 字段（兼容不同格式）
  if (!param.name && !('label' in param)) {
    throw new ModelValidationError(`${prefix}.name or label is required`)
  }

  // 接受 default 或 defaultValue 字段（兼容不同格式）
  if (param.default === undefined && !('defaultValue' in param)) {
    throw new ModelValidationError(`${prefix}.default or defaultValue is required`)
  }

  // 验证特定组件类型的字段
  if (param.type === 'dropdown' || param.type === 'radio') {
    if (!('options' in param) || !Array.isArray(param.options)) {
      throw new ModelValidationError(`${prefix}.options is required for ${param.type}`)
    }
  }

  if (param.type === 'number') {
    if (!('min' in param) || typeof param.min !== 'number') {
      throw new ModelValidationError(`${prefix}.min is required for ${param.type}`)
    }
    if (!('max' in param) || typeof param.max !== 'number') {
      throw new ModelValidationError(`${prefix}.max is required for ${param.type}`)
    }
  }
}

/**
 * 验证联动规则
 */
function validateLinkages(model: ModelDefinition): void {
  const { linkages, params } = model

  if (!linkages) return

  if (!Array.isArray(linkages)) {
    throw new ModelValidationError('Model linkages must be an array')
  }

  const paramIds = new Set(params.map((p) => p.id))

  linkages.forEach((linkage, index) => {
    const prefix = `Model linkages[${index}]`

    // 检查必需字段
    if (!linkage.trigger) {
      throw new ModelValidationError(`${prefix}.trigger is required`)
    }

    if (!linkage.effect) {
      throw new ModelValidationError(`${prefix}.effect is required`)
    }

    // 验证触发器参数存在
    const triggers = Array.isArray(linkage.trigger) ? linkage.trigger : [linkage.trigger]
    triggers.forEach((trigger: string) => {
      const baseParam = trigger.split('.')[0]
      // Allow context parameters that are not explicitly defined in model params
      const contextParams = ['images', 'videos', 'uploadedImages', 'uploadedVideos']
      if (!paramIds.has(baseParam) && !contextParams.includes(baseParam)) {
        throw new ModelValidationError(
          `${prefix}.trigger references non-existent param: ${trigger}`
        )
      }
    })

    // 验证目标参数存在（根据联动类型）
    if ('target' in linkage && linkage.target) {
      const baseParam = linkage.target.split('.')[0]
      if (!paramIds.has(baseParam)) {
        throw new ModelValidationError(
          `${prefix}.target references non-existent param: ${linkage.target}`
        )
      }
    }

    if ('targets' in linkage && linkage.targets) {
      linkage.targets.forEach((target: string) => {
        const baseParam = target.split('.')[0]
        if (!paramIds.has(baseParam)) {
          throw new ModelValidationError(
            `${prefix}.targets references non-existent param: ${target}`
          )
        }
      })
    }
  })
}

/**
 * 验证端点配置
 */
function validateEndpoints(model: ModelDefinition): void {
  const { endpoints } = model

  if (!endpoints) {
    throw new ModelValidationError('Model endpoints is required')
  }

  // 如果是字符串，直接返回（固定端点）
  if (typeof endpoints === 'string') {
    return
  }

  // 如果是对象，检查是否有 default 或 rules 或 selector
  if (typeof endpoints === 'object') {
    const hasDefault = 'default' in endpoints && typeof endpoints.default === 'string'
    const hasRules = 'rules' in endpoints && Array.isArray(endpoints.rules)
    const hasSelector = 'selector' in endpoints && typeof endpoints.selector === 'function'

    if (!hasDefault && !hasRules && !hasSelector) {
      throw new ModelValidationError(
        'Model endpoints must have at least one of: default, rules, selector'
      )
    }

    // 验证 rules
    if (hasRules) {
      endpoints.rules!.forEach((rule, index) => {
        if (!rule.endpoint || typeof rule.endpoint !== 'string') {
          throw new ModelValidationError(`Model endpoints.rules[${index}].endpoint is required`)
        }
      })
    }
  } else {
    throw new ModelValidationError('Model endpoints must be a string or EndpointConfig object')
  }
}

/**
 * 验证价格配置
 */
function validatePricing(model: ModelDefinition): void {
  const { pricing } = model

  if (!pricing) {
    throw new ModelValidationError('Model pricing is required')
  }

  if (!pricing.currency || typeof pricing.currency !== 'string') {
    throw new ModelValidationError('Model pricing.currency is required and must be a string')
  }

  // 必须有 fixed 或 calculator 之一
  const hasFixed = typeof pricing.fixed === 'number'
  const hasCalculator = typeof pricing.calculator === 'function'

  if (!hasFixed && !hasCalculator) {
    throw new ModelValidationError('Model pricing must have either fixed or calculator')
  }

  // 如果有 fixed，检查是否为非负数
  if (hasFixed && pricing.fixed! < 0) {
    throw new ModelValidationError('Model pricing.fixed must be non-negative')
  }
}
