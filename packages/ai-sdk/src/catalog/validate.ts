/**
 * 模型运行时定义校验：只校验"模型是什么"——meta 标识字段、参数取值契约、端点、
 * 价格配置的结构完整性。展示层规则（i18n key 是否存在、面板分区引用、参数命名
 * 产品约定）留在应用侧 `src/core/validators/`，见任务 3.1 执行记录与
 * docs/task/模型SDK抽离/重要记录.md 记录 003。
 *
 * 这里的规则从 `src/core/validators/modelValidator.ts` 原样搬运（同一份检查逻辑、
 * 同样的报错文案），应用侧改为调用本模块，不再维护第二份判断，避免源码与副本
 * 静默分叉。
 */

import type {
  ModelRuntimeDefinition,
  RuntimeParamDef,
  RuntimeComponentType,
} from '../types/model'

export class ModelRuntimeValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelRuntimeValidationError'
  }
}

export type ValidationFailure = (message: string) => never

function defaultFail(message: string): never {
  throw new ModelRuntimeValidationError(message)
}

/** 校验模型运行时定义。校验失败时调用 `fail`（默认抛 `ModelRuntimeValidationError`）。 */
export function validateRuntimeModel(
  model: ModelRuntimeDefinition,
  fail: ValidationFailure = defaultFail
): void {
  validateMeta(model, fail)
  if (model.acceptsPrompt !== undefined && typeof model.acceptsPrompt !== 'boolean') {
    fail('Model acceptsPrompt must be a boolean')
  }
  validateParams(model, fail)
  validateEndpoints(model, fail)
  validatePricing(model, fail)
}

function validateMeta(model: ModelRuntimeDefinition, fail: ValidationFailure): void {
  const { meta } = model

  if (!meta.id || typeof meta.id !== 'string') {
    fail('Model meta.id is required and must be a string')
  }

  if (!meta.canonicalModelId || typeof meta.canonicalModelId !== 'string') {
    fail('Model meta.canonicalModelId is required and must be a string')
  }

  if (!meta.provider || typeof meta.provider !== 'string') {
    fail('Model meta.provider is required and must be a string')
  }

  if (typeof meta.type !== 'string' || meta.type.trim().length === 0) {
    fail('Model meta.type is required and must be a non-empty string')
  }

  if (meta.aliases) {
    if (!Array.isArray(meta.aliases)) {
      fail('Model meta.aliases must be an array')
    }
    meta.aliases.forEach((alias, index) => {
      if (typeof alias !== 'string') {
        fail(`Model meta.aliases[${index}] must be a string`)
      }
    })
  }

  if (meta.tags) {
    if (!Array.isArray(meta.tags)) {
      fail('Model meta.tags must be an array')
    }
  }

  if (meta.polling) {
    if (typeof meta.polling.interval !== 'number' || meta.polling.interval <= 0) {
      fail('Model meta.polling.interval must be a positive number')
    }
    if (typeof meta.polling.maxAttempts !== 'number' || meta.polling.maxAttempts <= 0) {
      fail('Model meta.polling.maxAttempts must be a positive number')
    }
  }

  if (meta.progress) {
    const progress = meta.progress

    if (progress.mode !== 'time' && progress.mode !== 'polling') {
      fail('Model meta.progress.mode must be time or polling')
    }

    if (progress.mode === 'time') {
      if (typeof progress.baseDurationMs !== 'number' || progress.baseDurationMs <= 0) {
        fail('Model meta.progress.baseDurationMs must be a positive number')
      }
      if (progress.perUnitMs !== undefined && (typeof progress.perUnitMs !== 'number' || progress.perUnitMs < 0)) {
        fail('Model meta.progress.perUnitMs must be a non-negative number')
      }
      if (progress.tickMs !== undefined && (typeof progress.tickMs !== 'number' || progress.tickMs <= 0)) {
        fail('Model meta.progress.tickMs must be a positive number')
      }
      if (progress.scaleWith !== undefined && typeof progress.scaleWith !== 'string') {
        fail('Model meta.progress.scaleWith must be a string')
      }
      if (progress.minDurationMs !== undefined && (typeof progress.minDurationMs !== 'number' || progress.minDurationMs <= 0)) {
        fail('Model meta.progress.minDurationMs must be a positive number')
      }
      if (progress.maxDurationMs !== undefined && (typeof progress.maxDurationMs !== 'number' || progress.maxDurationMs <= 0)) {
        fail('Model meta.progress.maxDurationMs must be a positive number')
      }
    }

    if (progress.mode === 'polling') {
      if (typeof progress.baseAttempts !== 'number' || progress.baseAttempts <= 0) {
        fail('Model meta.progress.baseAttempts must be a positive number')
      }
      if (progress.perUnitAttempts !== undefined && (typeof progress.perUnitAttempts !== 'number' || progress.perUnitAttempts < 0)) {
        fail('Model meta.progress.perUnitAttempts must be a non-negative number')
      }
      if (progress.intervalMs !== undefined && (typeof progress.intervalMs !== 'number' || progress.intervalMs <= 0)) {
        fail('Model meta.progress.intervalMs must be a positive number')
      }
      if (progress.tickMs !== undefined && (typeof progress.tickMs !== 'number' || progress.tickMs <= 0)) {
        fail('Model meta.progress.tickMs must be a positive number')
      }
      if (progress.scaleWith !== undefined && typeof progress.scaleWith !== 'string') {
        fail('Model meta.progress.scaleWith must be a string')
      }
      if (progress.minAttempts !== undefined && (typeof progress.minAttempts !== 'number' || progress.minAttempts <= 0)) {
        fail('Model meta.progress.minAttempts must be a positive number')
      }
      if (progress.maxAttempts !== undefined && (typeof progress.maxAttempts !== 'number' || progress.maxAttempts <= 0)) {
        fail('Model meta.progress.maxAttempts must be a positive number')
      }
      if (progress.minDurationMs !== undefined && (typeof progress.minDurationMs !== 'number' || progress.minDurationMs <= 0)) {
        fail('Model meta.progress.minDurationMs must be a positive number')
      }
      if (progress.maxDurationMs !== undefined && (typeof progress.maxDurationMs !== 'number' || progress.maxDurationMs <= 0)) {
        fail('Model meta.progress.maxDurationMs must be a positive number')
      }
    }

    if (progress.minDurationMs !== undefined && progress.maxDurationMs !== undefined && progress.minDurationMs > progress.maxDurationMs) {
      fail('Model meta.progress.minDurationMs must be <= maxDurationMs')
    }

    const curve = progress.curve
    if (curve) {
      if (curve.slowStart !== undefined && (typeof curve.slowStart !== 'number' || curve.slowStart <= 0 || curve.slowStart >= 100)) {
        fail('Model meta.progress.curve.slowStart must be between 0 and 100')
      }
      if (curve.slowEnd !== undefined && (typeof curve.slowEnd !== 'number' || curve.slowEnd <= 0 || curve.slowEnd >= 100)) {
        fail('Model meta.progress.curve.slowEnd must be between 0 and 100')
      }
      if (curve.cap !== undefined && (typeof curve.cap !== 'number' || curve.cap <= 0 || curve.cap >= 100)) {
        fail('Model meta.progress.curve.cap must be between 0 and 100')
      }
      if (curve.tailFactor !== undefined && (typeof curve.tailFactor !== 'number' || curve.tailFactor <= 0)) {
        fail('Model meta.progress.curve.tailFactor must be a positive number')
      }
      if (curve.slowStart !== undefined && curve.slowEnd !== undefined && curve.slowStart >= curve.slowEnd) {
        fail('Model meta.progress.curve.slowStart must be < slowEnd')
      }
      if (curve.slowEnd !== undefined && curve.cap !== undefined && curve.slowEnd >= curve.cap) {
        fail('Model meta.progress.curve.slowEnd must be < cap')
      }
    }
  }

  if (meta.progressLearning) {
    const { segments, enableTimeBuckets } = meta.progressLearning

    if (enableTimeBuckets !== undefined && typeof enableTimeBuckets !== 'boolean') {
      fail('Model meta.progressLearning.enableTimeBuckets must be a boolean')
    }

    if (segments !== undefined) {
      if (!Array.isArray(segments)) {
        fail('Model meta.progressLearning.segments must be an array')
      }

      segments.forEach((segment, index) => {
        if (!segment || typeof segment !== 'object') {
          fail(`Model meta.progressLearning.segments[${index}] must be an object`)
        }

        if (segment.kind === 'field') {
          if (typeof segment.field !== 'string' || segment.field.trim().length === 0) {
            fail(`Model meta.progressLearning.segments[${index}].field must be a non-empty string`)
          }
          return
        }

        if (segment.kind === 'textLength') {
          if (segment.field !== 'prompt' && segment.field !== 'text') {
            fail(`Model meta.progressLearning.segments[${index}].field must be prompt or text`)
          }
          if (!Array.isArray(segment.buckets) || segment.buckets.length === 0) {
            fail(`Model meta.progressLearning.segments[${index}].buckets must be a non-empty array`)
          }
          segment.buckets.forEach((bucket, bucketIndex) => {
            if (typeof bucket !== 'number' || !Number.isFinite(bucket) || bucket <= 0) {
              fail(`Model meta.progressLearning.segments[${index}].buckets[${bucketIndex}] must be a positive number`)
            }
          })
          return
        }

        fail(`Model meta.progressLearning.segments[${index}].kind must be field or textLength`)
      })
    }
  }
}

const VALID_PARAM_TYPES: RuntimeComponentType[] = [
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
  'aspect-ratio',
]

function validateParams(model: ModelRuntimeDefinition, fail: ValidationFailure): void {
  const { params } = model

  if (!Array.isArray(params)) {
    fail('Model params must be an array')
  }

  const paramIds = new Set<string>()

  params.forEach((param, index) => {
    validateParam(param, index, fail)

    if (paramIds.has(param.id)) {
      fail(`Duplicate param ID: ${param.id}`)
    }
    paramIds.add(param.id)
  })
}

function validateParam(param: RuntimeParamDef, index: number, fail: ValidationFailure): void {
  const prefix = `Model params[${index}]`

  if (!param.id || typeof param.id !== 'string') {
    fail(`${prefix}.id is required and must be a string`)
  }

  if (!param.type) {
    fail(`${prefix}.type is required`)
  }

  if (!VALID_PARAM_TYPES.includes(param.type)) {
    fail(`${prefix}.type must be one of: ${VALID_PARAM_TYPES.join(', ')}`)
  }

  if (typeof param.order !== 'number') {
    fail(`${prefix}.order must be a number`)
  }

  if (param.default === undefined) {
    fail(`${prefix}.default is required`)
  }

  if (param.type === 'dropdown' || param.type === 'radio') {
    if (!('options' in param) || !Array.isArray(param.options)) {
      fail(`${prefix}.options is required for ${param.type}`)
    }
  }

  if (param.type === 'number') {
    if (!('min' in param) || typeof param.min !== 'number') {
      fail(`${prefix}.min is required for ${param.type}`)
    }
    if (!('max' in param) || typeof param.max !== 'number') {
      fail(`${prefix}.max is required for ${param.type}`)
    }
  }
}

function validateEndpoints(model: ModelRuntimeDefinition, fail: ValidationFailure): void {
  const { endpoints } = model

  if (!endpoints) {
    fail('Model endpoints is required')
  }

  if (typeof endpoints === 'string') {
    return
  }

  if (typeof endpoints === 'object') {
    const hasDefault = 'default' in endpoints && typeof endpoints.default === 'string'
    const hasRules = 'rules' in endpoints && Array.isArray(endpoints.rules)
    const hasSelector = 'selector' in endpoints && typeof endpoints.selector === 'function'

    if (!hasDefault && !hasRules && !hasSelector) {
      fail('Model endpoints must have at least one of: default, rules, selector')
    }

    if (hasRules) {
      endpoints.rules!.forEach((rule, index) => {
        if (!rule.endpoint || typeof rule.endpoint !== 'string') {
          fail(`Model endpoints.rules[${index}].endpoint is required`)
        }
      })
    }
  } else {
    fail('Model endpoints must be a string or EndpointConfig object')
  }
}

function validatePricing(model: ModelRuntimeDefinition, fail: ValidationFailure): void {
  const { pricing } = model

  if (!pricing) {
    fail('Model pricing is required')
  }

  if (!pricing.currency || typeof pricing.currency !== 'string') {
    fail('Model pricing.currency is required and must be a string')
  }

  const hasFixed = typeof pricing.fixed === 'number'
  const hasCalculator = typeof pricing.calculator === 'function'

  if (!hasFixed && !hasCalculator) {
    fail('Model pricing must have either fixed or calculator')
  }

  if (hasFixed && pricing.fixed! < 0) {
    fail('Model pricing.fixed must be non-negative')
  }

  if (
    pricing.estimateMode !== undefined
    && pricing.estimateMode !== 'total'
    && pricing.estimateMode !== 'unit'
  ) {
    fail('Model pricing.estimateMode must be total or unit')
  }

  if (pricing.estimateMode === 'unit') {
    if (typeof pricing.estimateUnit !== 'string' || pricing.estimateUnit.trim().length === 0) {
      fail('Model pricing.estimateUnit must be a non-empty string for unit estimates')
    }
  } else if (pricing.estimateUnit !== undefined) {
    fail('Model pricing.estimateUnit requires estimateMode unit')
  }
}
