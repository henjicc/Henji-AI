/**
 * 模型定义核心接口
 *
 * 这是新架构的核心类型定义，每个模型只需一个 .model.ts 文件
 * 包含元数据、参数、联动、端点、请求构建、价格计算等所有配置
 */

import { ModelTag } from './ModelTags'
import { I18nText } from './I18nText'
import type { EndpointConfig } from './EndpointConfig'
import type { RequestConfig } from './RequestConfig'
import type { PricingConfig } from './PricingConfig'
import type { ParamDef } from './ParamDef'
import type { Linkage } from './Linkage'

/**
 * 模型类型
 */
export type ModelType = 'image' | 'video' | 'audio'

/**
 * Provider ID
 */
export type ProviderId = 'ppio' | 'fal' | 'kie' | 'modelscope' | string

/**
 * 模型元数据
 *
 * 包含模型的基本信息
 */
export interface ModelMeta {
  /**
   * 模型唯一标识符
   *
   * @example "nano-banana", "seedream-4.0"
   */
  id: string

  /**
   * Provider ID
   *
   * @example "ppio", "fal", "kie", "modelscope"
   */
  provider: ProviderId

  /**
   * 模型类型
   */
  type: ModelType

  /**
   * 模型名称（支持国际化）
   *
   * @example { zh: "即梦图片 4.0", en: "Seedream 4.0" }
   */
  name: I18nText

  /**
   * 模型描述（可选，支持国际化）
   *
   * @example { zh: "先进的图像生成模型，支持4K分辨率", en: "Advanced image generation model with 4K resolution" }
   */
  description?: I18nText

  /**
   * 模型标签
   *
   * 用于描述模型的能力和特性
   *
   * @example ['text-to-image', 'supports-image-editing', 'supports-4k']
   */
  tags?: ModelTag[]

  /**
   * 模型图标 URL（可选）
   *
   * @example "/icons/nano-banana.png"
   */
  icon?: string

  /**
   * 轮询配置（可选）
   *
   * 用于异步任务的状态轮询
   */
  polling?: {
    /**
     * 轮询间隔（毫秒）
     *
     * @default 3000
     */
    interval: number

    /**
     * 最大轮询次数
     *
     * @default 100
     */
    maxAttempts: number

    /**
     * 预期轮询次数（用于进度计算）
     *
     * @example 30
     */
    expectedAttempts?: number
  }

  /**
   * 模型别名（可选）
   *
   * 用于兼容旧的模型 ID
   *
   * @example ["fal-ai-nano-banana", "nano-banana-fal"]
   */
  aliases?: string[]
}

/**
 * 参数定义（从 ParamDef 导入）
 */
export type { ParamDef } from './ParamDef'

/**
 * 联动规则（从 Linkage 导入）
 */
export type { Linkage } from './Linkage'

/**
 * 模型定义（核心接口）
 *
 * 每个模型的完整配置，包含所有必要信息
 *
 * @example
 * ```typescript
 * export const nanoBananaModel: ModelDefinition = {
 *   meta: {
 *     id: 'nano-banana',
 *     provider: 'fal',
 *     type: 'image',
 *     name: { zh: 'Nano Banana', en: 'Nano Banana' },
 *     description: { zh: 'Google 最先进的图像生成模型', en: 'Google\'s most advanced image generation model' },
 *     tags: ['text-to-image', 'image-to-image', 'supports-image-editing'],
 *     polling: {
 *       interval: 3000,
 *       maxAttempts: 100,
 *       expectedAttempts: 30
 *     }
 *   },
 *
 *   params: [
 *     // 参数定义（Phase 1-1-2）
 *   ],
 *
 *   linkages: [
 *     // 联动规则（Phase 1-1-3）
 *   ],
 *
 *   endpoints: {
 *     rules: [
 *       { when: { hasImage: true }, endpoint: '/fal-ai/image-to-image' },
 *       { when: { hasImage: false }, endpoint: '/fal-ai/text-to-image' }
 *     ],
 *     default: '/fal-ai/text-to-image'
 *   },
 *
 *   request: {
 *     base: {
 *       prompt: 'input.prompt',
 *       image_url: 'input.imageUrl',
 *       num_images: 'options.numImages'
 *     },
 *     preprocess: (params) => {
 *       // 预处理逻辑
 *       return params
 *     }
 *   },
 *
 *   pricing: {
 *     currency: '¥',
 *     fixed: 0.1
 *   }
 * }
 * ```
 */
export interface ModelDefinition {
  /**
   * 模型元数据
   */
  meta: ModelMeta

  /**
   * 参数定义数组
   *
   * 定义模型支持的所有参数
   * 详细类型将在 Phase 1-1-2 中定义
   */
  params: ParamDef[]

  /**
   * 参数联动规则（可选）
   *
   * 定义参数之间的联动关系
   * 详细类型将在 Phase 1-1-3 中定义
   */
  linkages?: Linkage[]

  /**
   * 端点配置
   *
   * 定义如何选择 API 端点
   */
  endpoints: EndpointConfig

  /**
   * 请求构建配置（可选）
   *
   * 定义如何构建 API 请求
   * 如果不提供，使用默认的字段映射
   */
  request?: RequestConfig

  /**
   * 价格配置
   *
   * 定义模型的价格计算规则
   */
  pricing: PricingConfig
}

/**
 * 模型定义映射表
 *
 * 键：模型 ID
 * 值：模型定义
 */
export type ModelDefinitionMap = Record<string, ModelDefinition>
