import { createLogger } from '@/core/logging'

const logger = createLogger('core.request.RequestBuilder')
/**
 * RequestBuilder - 统一的请求构建器
 *
 * 整合新旧 OptionsBuilder 系统，为模型生成 API 请求
 */

import { registry } from '../ModelRegistry'
import type { ModelDefinition, ParamDef } from '../types'
import type { ParamFlowTracker } from '../debug/ParamFlowTracker'
import { EndpointSelector, type SelectContext } from './EndpointSelector'

/**
 * 构建结果接口
 */
export interface BuildResult {
  /**
   * API 端点 URL
   */
  url: string

  /**
   * HTTP 方法
   */
  method: string

  /**
   * 请求体
   */
  body: DynamicValueMap
}

/**
 * 构建选项
 */
export interface BuildOptions {
  /**
   * 是否启用调试日志
   */
  debug?: boolean

  /**
   * 是否验证参数
   */
  validate?: boolean

  /**
   * 自定义上下文
   */
  context?: DynamicValueMap

  /**
   * 参数流转追踪器（可选）
   */
  tracker?: ParamFlowTracker
}

/**
 * RequestBuilder 类
 *
 * 负责将模型参数转换为 API 请求
 */
export class RequestBuilder {
  /**
   * 构建 API 请求
   *
   * @param modelId - 模型 ID
   * @param params - 参数对象
   * @param options - 构建选项
   * @returns 构建结果（可能是 Promise）
   *
   * @example
   * ```typescript
   * const builder = new RequestBuilder()
   * const request = await builder.build('wan-2.6', {
   *   prompt: 'A beautiful sunset',
   *   duration: 5,
   *   aspectRatio: '16:9'
   * })
   * // { url: '/t2v', method: 'POST', body: { ... } }
   * ```
   */
  async build(
    modelId: string,
    params: DynamicValueMap,
    options: BuildOptions = {}
  ): Promise<BuildResult> {
    const { debug = false, validate: _validate = true, context = {}, tracker } = options

    if (debug) {
      logger.info('[RequestBuilder] Building request for:', modelId)
      logger.info('[RequestBuilder] Params:', params)
      logger.info('[RequestBuilder] Context:', context)
    }

    // 获取模型定义
    const model = registry.getModel(modelId)

    if (!model) {
      throw new Error(`[RequestBuilder] Model not found: ${modelId}`)
    }

    // 检查是否有新配置
    if (this.hasNewConfig(model)) {
      if (debug) {
        logger.info('[RequestBuilder] Using new config engine')
      }
      return await this.buildWithNewConfig(model, params, context, debug, tracker)
    } else {
      if (debug) {
        logger.info('[RequestBuilder] Using legacy builder (fallback)')
      }
      return this.buildWithOldConfig(modelId, params, context)
    }
  }

  /**
   * 检查是否有新配置
   *
   * @param model - 模型定义
   * @returns 是否有新配置
   */
  private hasNewConfig(model: ModelDefinition): boolean {
    return model.params.length > 0 && model.endpoints !== undefined
  }

  /**
   * 使用新配置构建请求
   *
   * @param model - 模型定义
   * @param params - 参数对象
   * @param context - 上下文
   * @param debug - 是否启用调试
   * @param tracker - 参数流转追踪器（可选）
   * @returns 构建结果
   */
  private async buildWithNewConfig(
    model: ModelDefinition,
    params: DynamicValueMap,
    context: DynamicValueMap,
    debug: boolean,
    tracker?: ParamFlowTracker
  ): Promise<BuildResult> {
    // 1. 选择端点（统一走 EndpointSelector，支持 routes/key 解析）
    const selector = new EndpointSelector(model.endpoints)
    const selectContext = this.buildEndpointSelectContext(params, context)
    const { endpoint: endpointKey, route } = await selector.select(params, selectContext)

    if (debug) {
      logger.info('[RequestBuilder] Selected endpoint:', endpointKey)
      logger.info('[RequestBuilder] Resolved route:', route)
    }

    // 3. 构建请求体
    let body: DynamicValueMap = {}

    // 3.0 如果模型定义了 request.builder，优先使用它
    if (model.request?.builder && typeof model.request.builder === 'function') {
      if (debug) {
        logger.info('[RequestBuilder] Using model request.builder')
      }
      // 支持异步 builder
      const builderResult = model.request.builder(params)
      body = builderResult instanceof Promise ? await builderResult : builderResult
    } else {
      // 3.1 添加基础参数
      if (model.request?.base) {
        body = { ...model.request.base }
        if (debug) {
          logger.info('[RequestBuilder] Base params:', model.request.base)
        }
      }

      // 3.2 映射参数
      // 构建 apiField -> paramId 的反向映射，用于支持 API 字段名作为输入
      const apiFieldToParamId: Record<string, string> = {}
      for (const paramDef of model.params) {
        if ('apiField' in paramDef && paramDef.apiField) {
          apiFieldToParamId[paramDef.apiField as string] = paramDef.id
        }
      }

      if (debug) {
        logger.info('[RequestBuilder] Input params keys:', Object.keys(params))
        logger.info('[RequestBuilder] Model param IDs:', model.params.map(p => p.id))
        logger.info('[RequestBuilder] API field mapping:', apiFieldToParamId)
      }

      for (const paramDef of model.params) {
        // 优先使用参数 ID 查找值，如果找不到则尝试使用 apiField 查找
        let value = params[paramDef.id]
        if (value === undefined && 'apiField' in paramDef && paramDef.apiField) {
          value = params[paramDef.apiField as string]
        }

        if (debug) {
          logger.info(`[RequestBuilder] Checking param ${paramDef.id}:`, value)
        }

        // 跳过未设置的参数
        if (value === undefined || value === null || value === '') {
          continue
        }

        // 应用映射
        const mapped = this.mapParam(paramDef, value, endpointKey, params, debug)

        if (Object.keys(mapped).length > 0) {
          Object.assign(body, mapped)

          // 记录转换
          if (tracker) {
            for (const [apiKey, apiValue] of Object.entries(mapped)) {
              if (apiValue !== value) {
                tracker.recordTransform(
                  paramDef.id,
                  value,
                  apiValue,
                  `apiField: ${apiKey}`
                )
              }
            }
          }

          if (debug) {
            logger.info(`[RequestBuilder] Mapped ${paramDef.id}:`, mapped)
          }
        }
      }
    }

    // 3.3 应用预处理
    if (model.request?.preprocess) {
      const preprocessed = model.request.preprocess(body)
      if (preprocessed) {
        body = preprocessed
        if (debug) {
          logger.info('[RequestBuilder] Preprocessed body:', body)
        }
      }
    }

    // 记录 API 构建阶段
    if (tracker) {
      tracker.recordAPIBuild(body)
    }

    const result: BuildResult = {
      url: route.path,
      method: route.method || 'POST',
      body
    }

    // 日志由 ProviderHandler 统一输出，这里不再重复

    return result
  }

  private buildEndpointSelectContext(
    params: DynamicValueMap,
    context: DynamicValueMap
  ): SelectContext {
    const next: SelectContext = { ...(context || {}) }

    if (next.hasImage === undefined) {
      const images = params?.images
      const image = params?.image
      next.hasImage =
        (Array.isArray(images) && images.length > 0) ||
        (Array.isArray(image) && image.length > 0)
    }

    if (next.hasVideo === undefined) {
      const video = params?.video
      const videos = params?.videos
      next.hasVideo =
        Boolean(video) || (Array.isArray(videos) && videos.length > 0)
    }

    return next
  }

  /**
   * 映射单个参数
   *
   * 优先级：apiMapping > apiTransform > apiField
   *
   * @param paramDef - 参数定义
   * @param value - 参数值
   * @param endpointKey - 端点键
   * @param allParams - 所有参数
   * @param debug - 是否启用调试
   * @returns 映射后的参数对象
   */
  private mapParam(
    paramDef: ParamDef,
    value: DynamicValue,
    endpointKey: string,
    allParams: DynamicValueMap,
    debug: boolean
  ): DynamicValueMap {
    // 1. apiMapping（端点相关映射）
    if ('apiMapping' in paramDef && (paramDef as DynamicValue).apiMapping?.[endpointKey]) {
      const mapping = (paramDef as DynamicValue).apiMapping[endpointKey]
      if (debug) {
        logger.info(`[RequestBuilder] Using apiMapping for ${paramDef.id} at endpoint ${endpointKey}`)
      }
      return mapping.transform(value, allParams)
    }

    // 2. apiTransform（通用转换）
    if ('apiTransform' in paramDef && paramDef.apiTransform) {
      if (debug) {
        logger.info(`[RequestBuilder] Using apiTransform for ${paramDef.id}`)
      }
      return (paramDef as DynamicValue).apiTransform(value, allParams)
    }

    // 3. apiField（简单映射）
    if ('apiField' in paramDef && paramDef.apiField) {
      if (debug) {
        logger.info(`[RequestBuilder] Using apiField for ${paramDef.id}: ${paramDef.apiField}`)
      }
      return { [(paramDef.apiField as string)]: this.convertType(value, paramDef.valueType) }
    }

    // 无映射配置，不发送
    if (debug) {
      logger.info(`[RequestBuilder] No mapping for ${paramDef.id}, skipping`)
    }
    return {}
  }

  /**
   * 类型转换
   *
   * @param value - 原始值
   * @param type - 目标类型
   * @returns 转换后的值
   */
  private convertType(value: DynamicValue, type: string | undefined): DynamicValue {
    switch (type) {
      case 'number':
        return Number(value)
      case 'boolean':
        return Boolean(value)
      case 'string':
        return String(value)
      default:
        return value
    }
  }

  /**
   * 使用旧配置构建请求（降级）
   *
   * @param modelId - 模型 ID
   * @param params - 参数对象
   * @param context - 上下文
   * @returns 构建结果
   */
  private buildWithOldConfig(
    modelId: string,
    _params: DynamicValueMap,
    _context: DynamicValueMap
  ): BuildResult {
    logger.warn(`[RequestBuilder] Using legacy builder for: ${modelId}`)
    logger.warn('[RequestBuilder] Legacy builder integration not implemented yet')
    logger.warn('[RequestBuilder] Please migrate this model to new config system')

    // TODO: 集成旧的 optionsBuilder
    // const oldBuilder = require('@/components/MediaGenerator/builders/optionsBuilder')
    // return oldBuilder.buildRequest(modelId, params, context)

    throw new Error(
      `[RequestBuilder] Model ${modelId} has no new config and legacy builder is not implemented`
    )
  }
}

/**
 * 单例实例
 */
export const requestBuilder = new RequestBuilder()

