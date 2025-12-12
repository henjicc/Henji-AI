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
  /** 最大视频数量 */
  maxVideos?: number
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
  provider: 'ppio' | 'fal' | 'modelscope' | 'custom' | 'kie'

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

/**
 * buildGenerateOptions 函数的参数类型
 */
export interface BuildOptionsParams {
  // 基础参数
  currentModel?: any
  selectedModel: string
  uploadedImages: string[]
  uploadedFilePaths?: string[]
  setUploadedFilePaths?: (paths: string[]) => void
  uploadedVideoFilePaths?: string[]
  setUploadedVideoFilePaths?: (paths: string[]) => void

  // 分辨率参数
  selectedResolution?: string
  resolutionQuality?: '2K' | '4K'
  customWidth?: string
  customHeight?: string
  isManualInput?: boolean
  resolutionBaseSize?: number

  // 图片参数
  maxImages?: number
  numImages?: number
  aspectRatio?: string
  resolution?: string
  modelscopeImageSize?: string

  // 视频通用参数
  videoDuration?: number
  videoAspectRatio?: string
  videoResolution?: string
  videoNegativePrompt?: string
  videoSeed?: number

  // 派欧云模型参数
  ppioKling25VideoDuration?: number
  ppioKling25VideoAspectRatio?: string
  ppioKling25CfgScale?: number
  ppioHailuo23VideoDuration?: number
  ppioHailuo23VideoResolution?: string
  ppioHailuo23FastMode?: boolean
  ppioHailuo23EnablePromptExpansion?: boolean
  ppioPixverse45VideoAspectRatio?: string
  ppioPixverse45VideoResolution?: string
  ppioPixverse45FastMode?: boolean
  ppioPixverse45Style?: string
  ppioWan25VideoDuration?: number
  ppioWan25Size?: string
  ppioWan25PromptExtend?: boolean
  ppioWan25Audio?: boolean
  ppioSeedanceV1VideoDuration?: number
  ppioSeedanceV1Variant?: 'lite' | 'pro'
  ppioSeedanceV1Resolution?: string
  ppioSeedanceV1AspectRatio?: string
  ppioSeedanceV1CameraFixed?: boolean
  ppioViduQ1Mode?: string
  ppioViduQ1Style?: string
  ppioViduQ1MovementAmplitude?: string
  ppioViduQ1Bgm?: boolean
  ppioViduQ1AspectRatio?: string

  // Fal 图片模型参数
  falNanoBananaAspectRatio?: string
  falNanoBananaNumImages?: number
  falNanoBananaProAspectRatio?: string
  falNanoBananaProNumImages?: number
  falKlingImageO1AspectRatio?: string
  falKlingImageO1NumImages?: number
  falZImageTurboImageSize?: string
  falZImageTurboNumImages?: number
  falZImageTurboNumInferenceSteps?: number
  falZImageTurboEnablePromptExpansion?: boolean
  falZImageTurboAcceleration?: string
  falSeedream40NumImages?: number

  // Fal 视频模型参数
  falWan25VideoDuration?: number
  falWan25AspectRatio?: string
  falWan25Resolution?: string
  falWan25PromptExpansion?: boolean
  falSeedanceV1VideoDuration?: number
  falSeedanceV1Mode?: string
  falSeedanceV1Version?: 'lite' | 'pro'
  falSeedanceV1FastMode?: boolean
  falVeo31VideoDuration?: number
  falVeo31Mode?: string
  falVeo31AspectRatio?: string
  falVeo31Resolution?: string
  falVeo31EnhancePrompt?: boolean
  falVeo31GenerateAudio?: boolean
  falVeo31AutoFix?: boolean
  falVeo31FastMode?: boolean
  falHailuo23Duration?: string
  falHailuo23Resolution?: string
  falHailuo23FastMode?: boolean
  falHailuo23PromptOptimizer?: boolean
  falHailuo02Duration?: string
  falHailuo02Resolution?: string
  falHailuo02FastMode?: boolean
  falHailuo02PromptOptimizer?: boolean
  falKlingVideoO1VideoDuration?: number
  falKlingVideoO1Mode?: string
  falKlingVideoO1AspectRatio?: string
  falKlingVideoO1KeepAudio?: boolean
  falKlingVideoO1Elements?: any[]
  falKlingV26ProVideoDuration?: number
  falKlingV26ProAspectRatio?: string
  falKlingV26ProGenerateAudio?: boolean
  falKlingV26ProCfgScale?: number
  falSora2VideoDuration?: number
  falSora2Mode?: string
  falSora2AspectRatio?: string
  falSora2Resolution?: string
  falLtx2VideoDuration?: number
  falLtx2Mode?: string
  falLtx2Resolution?: string
  falLtx2Fps?: number
  falLtx2GenerateAudio?: boolean
  falLtx2FastMode?: boolean
  falLtx2RetakeDuration?: number
  falLtx2RetakeStartTime?: number
  falLtx2RetakeMode?: string
  falViduQ2VideoDuration?: number
  falViduQ2Mode?: string
  falViduQ2AspectRatio?: string
  falViduQ2Resolution?: string
  falViduQ2MovementAmplitude?: string
  falViduQ2Bgm?: boolean
  falViduQ2FastMode?: boolean
  falPixverse55VideoDuration?: number
  falPixverse55AspectRatio?: string
  falPixverse55Resolution?: string
  falPixverse55Style?: string
  falPixverse55ThinkingType?: string
  falPixverse55GenerateAudio?: boolean
  falPixverse55MultiClip?: boolean

  // 视频上传
  uploadedVideos?: string[]
  uploadedVideoFiles?: File[]

  // 音频参数
  minimaxAudioSpeed?: number
  minimaxAudioEmotion?: string
  minimaxVoiceId?: string
  minimaxAudioSpec?: 'hd' | 'turbo'
  minimaxAudioVol?: number
  minimaxAudioPitch?: number
  minimaxAudioSampleRate?: number
  minimaxAudioBitrate?: number
  minimaxAudioFormat?: string
  minimaxAudioChannel?: number
  minimaxLatexRead?: boolean
  minimaxTextNormalization?: boolean
  minimaxLanguageBoost?: string

  // 魔搭模型参数
  modelscopeSteps?: number
  modelscopeGuidance?: number
  modelscopeNegativePrompt?: string
  modelscopeCustomModel?: string

  // KIE 图片模型参数
  kieNanoBananaAspectRatio?: string
  kieNanoBananaResolution?: string
  kieNanoBananaOutputFormat?: string
  kieSeedreamAspectRatio?: string
  kieSeedreamQuality?: string
  kieSeedream40AspectRatio?: string
  kieSeedream40Resolution?: string
  kieSeedream40MaxImages?: number
  kieGrokImagineAspectRatio?: string
  kieZImageAspectRatio?: string

  // KIE 视频模型参数
  kieGrokImagineVideoAspectRatio?: string
  kieGrokImagineVideoMode?: string
  kieKlingV26AspectRatio?: string
  kieKlingV26Duration?: string
  kieKlingV26EnableAudio?: boolean
  kieHailuo23Mode?: string
  kieHailuo23Duration?: number
  kieHailuo23Resolution?: string
  kieHailuo02Duration?: number
  kieHailuo02Resolution?: string
  kieHailuo02PromptOptimizer?: boolean
  kieSeedanceV3Version?: string
  kieSeedanceV3AspectRatio?: string
  kieSeedanceV3Resolution?: string
  kieSeedanceV3Duration?: string
  kieSeedanceV3CameraFixed?: boolean
  kieSeedanceV3FastMode?: boolean

  // 智能分辨率计算函数
  calculateSmartResolution?: (img: string) => Promise<string>
  calculateSeedreamSmartResolution?: (img: string) => Promise<string>
  calculatePPIOSeedreamSmartResolution?: (img: string) => Promise<string>
}
