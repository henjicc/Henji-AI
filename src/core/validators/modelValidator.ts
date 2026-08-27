/**
 * 模型验证器
 *
 * 验证 ModelDefinition 配置的完整性和正确性。
 *
 * 任务 3.1 起：meta 标识字段、参数取值契约（type/order/options/min-max）、端点、
 * 价格配置这些"运行时规则"已经搬到 `@henjicc/ai-sdk` 的 `validateRuntimeModel`，
 * 这里改为直接调用它，不再维护第二份判断逻辑，避免手抄副本与源码静默分叉。
 * 本文件继续负责纯展示层规则：参数是否有名称
 * （name/label）、联动规则是否引用存在的参数、参数展示编排、参数命名产品约定。
 * 归属口径见 docs/task/模型SDK抽离/重要记录.md 记录 003。
 */

import { ModelDefinition } from '../types'
import { validateRuntimeModel, type ModelRuntimeDefinition } from '@henjicc/ai-sdk'
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
  // 1. 校验 canonicalModelId 是否在通用描述目录注册（展示层数据，SDK 不知道这份目录）
  validateCanonicalDescription(model)

  // 2. 委托 SDK 校验运行时规则：meta 标识字段、参数取值契约、端点、价格
  validateRuntimeModel(model as unknown as ModelRuntimeDefinition, (message) => {
    throw new ModelValidationError(message)
  })

  // 3. 校验参数展示相关字段（name/label 必填）
  validateParamNames(model)

  // 4. 验证参数展示编排
  validateParamPresentation(model, (message) => {
    throw new ModelValidationError(message)
  })

  // 5. 验证联动规则
  validateLinkages(model)

  // 6. 参数命名产品约定（渠道/模式角色）
  validateModelParamConventions(model, (message) => {
    throw new ModelValidationError(message)
  })
}

/**
 * 校验 canonicalModelId 是否在通用描述目录注册。
 *
 * 这条留在应用侧而不是搬进 SDK 运行时校验：`generationModelDescriptions` 目录本身
 * 是展示层数据（模型描述文案），SDK 不知道、也不该知道这份目录的存在。
 */
function validateCanonicalDescription(model: ModelDefinition): void {
  const { meta } = model

  if (meta.canonicalModelId && !hasGenerationModelDescription(meta.canonicalModelId)) {
    throw new ModelValidationError(
      `Model meta.canonicalModelId is not registered in generationModelDescriptions: ${meta.canonicalModelId}`
    )
  }
}

/**
 * 校验参数展示名称：每个参数必须有 name（或兼容的 label）。
 *
 * 取值契约（id/type/order/default/options[].value/min/max）已经由
 * `validateRuntimeModel` 校验，这里只补运行时侧不掌握、纯展示层的 name 必填规则。
 */
function validateParamNames(model: ModelDefinition): void {
  model.params.forEach((param, index) => {
    const prefix = `Model params[${index}]`
    if (!param.name && !('label' in param)) {
      throw new ModelValidationError(`${prefix}.name or label is required`)
    }
  })
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
