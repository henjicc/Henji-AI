/**
 * 配置驱动架构 - 核心类型定义
 */

/**
 * 构建上下文
 */
export interface BuildContext {
  /** 选中的模型 ID */
  selectedModel: string
  /** 参数对象 */
  params: Record<string, any>
  /** 上传的图片列表 */
  uploadedImages: string[]
  /** 上传的视频列表 */
  uploadedVideos?: string[]
  /** 提示词 */
  prompt?: string
  /** 负面提示词 */
  negativePrompt?: string
}

/**
 * 参数映射规则
 */
export type ParamMappingRule =
  | string  // 简单映射：直接指定参数 key
  | {
      /** 参数来源（支持多个回退选项） */
      source: string | string[]
      /** 默认值 */
      defaultValue?: any
      /** 转换函数 */
      transform?: (value: any, context: BuildContext) => any
      /** 条件函数（返回 false 时不包含此参数） */
      condition?: (context: BuildContext) => boolean
    }

/**
 * 智能匹配配置
 */
export interface SmartMatchConfig {
  /** 是否启用智能匹配 */
  enabled: boolean
  /** 参数 key（在 paramMapping 中的 key） */
  paramKey: string
  /** 默认比例（智能匹配失败时使用） */
  defaultRatio: string
}

/**
 * 图片上传配置
 */
export interface ImageUploadConfig {
  /** 是否启用图片上传 */
  enabled: boolean
  /** 最大图片数量 */
  maxImages: number
  /** 上传模式 */
  mode: 'single' | 'multiple'
  /** 参数 key（在最终 options 中的 key） */
  paramKey?: string
  /** 是否转换为 Blob（PPIO 模型需要） */
  convertToBlob?: boolean
}

/**
 * 视频上传配置
 */
export interface VideoUploadConfig {
  /** 是否启用视频上传 */
  enabled: boolean
  /** 参数 key（在最终 options 中的 key） */
  paramKey?: string
  /** 是否转换为 Blob */
  convertToBlob?: boolean
}

/**
 * 模式切换配置
 */
export interface ModeSwitchConfig {
  /** 模式参数的 key */
  modeParamKey: string
  /** 不同模式下的配置 */
  configs: Record<string, ModeSpecificConfig>
}

/**
 * 模式特定配置
 */
export interface ModeSpecificConfig {
  /** 参数映射 */
  paramMapping?: Record<string, ParamMappingRule>
  /** 特性配置 */
  features?: {
    smartMatch?: SmartMatchConfig
    imageUpload?: ImageUploadConfig
    videoUpload?: VideoUploadConfig
  }
}

/**
 * 自定义处理器
 */
export interface CustomHandlers {
  /** 构建前处理 */
  beforeBuild?: (params: Record<string, any>, context: BuildContext) => Promise<void> | void
  /** 构建后处理 */
  afterBuild?: (options: Record<string, any>, context: BuildContext) => Promise<void> | void
  /** 参数验证 */
  validateParams?: (params: Record<string, any>) => void
}

/**
 * 模型配置
 */
export interface ModelConfig {
  /** 模型 ID */
  id: string
  /** 模型类型 */
  type: 'image' | 'video' | 'audio'
  /** 提供商 */
  provider: 'ppio' | 'fal' | 'modelscope' | 'custom'

  /** 参数映射规则 */
  paramMapping: Record<string, ParamMappingRule>

  /** 特性配置 */
  features?: {
    smartMatch?: SmartMatchConfig
    imageUpload?: ImageUploadConfig
    videoUpload?: VideoUploadConfig
    modeSwitch?: ModeSwitchConfig
  }

  /** 自定义处理器 */
  customHandlers?: CustomHandlers
}
