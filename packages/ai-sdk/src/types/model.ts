/**
 * 模型运行时契约：SDK 侧「模型是什么」——请求怎么构建、参数取值范围、价格计算。
 *
 * 「模型长什么样」（i18n 文案、面板布局、图标、联动关系）不在这里，留在痕迹AI 侧，
 * 见 `src/core/types/ModelPresentation.ts`。两侧的归属口径见
 * docs/task/模型SDK抽离/重要记录.md 记录 003（本文件是任务 3.1 的落地）。
 *
 * 这里保留 selector/builder 的真实函数，是 catalog 与所有宿主运行时共同消费的唯一模型
 * 契约；JSON DTO 等跨进程数据类型仍位于 `./runtime.ts`。
 */

import type {
  GenerateStatus,
  JsonValue,
  JsonObject,
  StructuredGenerationOutput,
} from './runtime'

// ========== 基础标识类型 ==========

/** SDK 内置的模型产出类型。开放类型仍保留这些字面量的编辑器补全。 */
export type BuiltinModelType = 'image' | 'video' | 'audio'

/**
 * 模型产出类型：内置类型 + 第三方扩展字符串。
 *
 * 它描述模型目录中的产出能力，不等同于上传预处理层的 `MediaKind`。
 */
// eslint-disable-next-line @typescript-eslint/ban-types -- string & {} 保留内置字面量补全，同时允许第三方扩展值。
export type ModelType = BuiltinModelType | (string & {})

/** SDK 随包提供的 8 个供应商；同时作为初始化与测试的单一清单。 */
export const BUILTIN_PROVIDER_IDS = [
  'apimart',
  'bailian',
  'volcengine',
  'ppio',
  'kie',
  'modelscope',
  'fal',
  'grsai',
] as const

/** 开放 ProviderId 仍保留这 8 个字面量的编辑器补全。 */
export type BuiltinProviderId = (typeof BUILTIN_PROVIDER_IDS)[number]

/** Provider ID：8 个内置供应商 + 第三方扩展字符串。 */
// eslint-disable-next-line @typescript-eslint/ban-types -- string & {} 避免开放类型把内置 provider 字面量提示坍缩掉。
export type ProviderId = BuiltinProviderId | (string & {})

/**
 * 模型标签。
 *
 * 应用侧 `src/core/types/ModelTags.ts` 维护了完整的 `KnownModelTag` 字面量清单 +
 * 中文描述表（给标签管理 UI 用），那份是产品资产，不搬进 SDK。SDK 只需要知道
 * "这是一串标签字符串"，不需要在类型层枚举穷尽值——枚举校验交给应用侧或未来的
 * 标签注册表。
 */
export type ModelTag = string

// ========== 进度估算配置（纯数值配置，无 I18nText 依赖） ==========

export interface ProgressCurveConfig {
  slowStart?: number
  slowEnd?: number
  cap?: number
  tailFactor?: number
}

export interface ProgressLearningFieldSegment {
  kind: 'field'
  field: string
}

export interface ProgressLearningTextLengthSegment {
  kind: 'textLength'
  field: 'prompt' | 'text'
  buckets: number[]
}

export type ModelProgressLearningSegment = ProgressLearningFieldSegment | ProgressLearningTextLengthSegment

export interface ModelProgressLearningConfig {
  segments?: ModelProgressLearningSegment[]
  enableTimeBuckets?: boolean
}

export interface ProgressTimeConfig {
  mode: 'time'
  baseDurationMs: number
  perUnitMs?: number
  scaleWith?: string
  minDurationMs?: number
  maxDurationMs?: number
  curve?: ProgressCurveConfig
  tickMs?: number
}

export interface ProgressPollingConfig {
  mode: 'polling'
  baseAttempts: number
  perUnitAttempts?: number
  scaleWith?: string
  minAttempts?: number
  maxAttempts?: number
  intervalMs?: number
  minDurationMs?: number
  maxDurationMs?: number
  curve?: ProgressCurveConfig
  tickMs?: number
}

export type ModelProgressConfig = ProgressTimeConfig | ProgressPollingConfig

// ========== 模型元数据（运行时部分） ==========

export interface ModelRuntimeMeta {
  /** 模型唯一标识符 */
  id: string

  /** 跨供应商复用的模型标识，通用描述目录按此字段解析（描述文案本身是展示资产） */
  canonicalModelId: string

  provider: ProviderId
  type: ModelType

  /** 模型能力标签 */
  tags?: ModelTag[]

  /** 轮询配置：异步任务状态轮询 */
  polling?: {
    interval: number
    maxAttempts: number
    expectedAttempts?: number
  }

  progress?: ModelProgressConfig
  progressLearning?: ModelProgressLearningConfig

  /** 模型别名，用于兼容旧的模型 ID */
  aliases?: string[]

  /** 旧模型 ID 合并为别名时，对应的参数默认值迁移 */
  aliasParamDefaults?: Record<string, JsonObject>

  /** 旧参数 ID 到当前 schema 参数 ID 的映射 */
  aliasParamMappings?: Record<string, Record<string, string>>

  /** 系列分组 ID，用于模型选择面板里的系列聚合排序 */
  seriesId?: string

  /** 系列内排序权重 */
  seriesRank?: number
}

// ========== 组件 / 值类型 ==========

export type RuntimeComponentType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'dropdown'
  | 'switch'
  | 'radio'
  | 'panel'
  | 'composite'
  | 'image-upload'
  | 'video-upload'
  | 'file-upload'
  | 'resolution'
  | 'aspect-ratio'

export type RuntimeValueType = 'string' | 'number' | 'boolean' | 'array' | 'object'

// ========== 条件 / API 映射（纯逻辑，无 I18nText） ==========

export type RuntimeConditionExpression = string
export type RuntimeConditionFunction = (params: JsonObject) => boolean

export interface RuntimeVisibleCondition {
  condition: RuntimeConditionExpression | RuntimeConditionFunction
  /** 调试用说明，纯字符串，不是 I18nText */
  reason?: string
}

export interface RuntimeDisabledCondition {
  condition: RuntimeConditionExpression | RuntimeConditionFunction
  reason?: string
}

export interface RuntimeSmartMatchConfig {
  targetParam: string
  matcher: (uploadedFile: {
    url: string
    filePath?: string
    dimensions?: { width: number; height: number }
    duration?: number
    size?: number
  }) => JsonValue
  autoApply?: boolean
}

export type RuntimeApiTransform = (value: JsonValue, allParams?: JsonObject) => JsonObject
export type RuntimeApiConfig = string | RuntimeApiTransform | Record<string, string | RuntimeApiTransform>

// ========== 参数定义：取值契约（去掉 I18nText 字段的 ParamDef） ==========

export interface RuntimeParamDefBase {
  id: string
  type: RuntimeComponentType
  order: number
  required?: boolean
  valueType?: RuntimeValueType
  default: JsonValue
  api?: RuntimeApiConfig
  apiField?: string
  apiTransform?: RuntimeApiTransform
  apiMapping?: Record<string, { transform: RuntimeApiTransform }>
  /** 跨模型切换时的参数语义标识 */
  transferKey?: string
  visible?: RuntimeVisibleCondition
  disabled?: RuntimeDisabledCondition
}

export interface RuntimeTextParamDef extends RuntimeParamDefBase {
  type: 'text' | 'textarea'
  valueType?: 'string'
  maxLength?: number
}

export interface RuntimeNumberParamDef extends RuntimeParamDefBase {
  type: 'number'
  valueType?: 'number'
  min?: number
  max?: number
  step?: number
}

/** dropdown/radio 的选项取值空间：只留 value（校验/请求需要），label 是展示资产 */
export interface RuntimeSelectOption {
  value: string | number
  disabled?: boolean
}

export interface RuntimeDropdownParamDef extends RuntimeParamDefBase {
  type: 'dropdown'
  valueType?: 'string' | 'number'
  options: RuntimeSelectOption[]
}

export interface RuntimeSwitchParamDef extends RuntimeParamDefBase {
  type: 'switch'
  valueType?: 'boolean'
}

export interface RuntimeRadioParamDef extends RuntimeParamDefBase {
  type: 'radio'
  valueType?: 'string' | 'number'
  options: RuntimeSelectOption[]
}

export interface RuntimePanelParamDef extends RuntimeParamDefBase {
  type: 'panel'
  valueType?: 'object'
  children: RuntimeParamDef[]
}

/**
 * 复合面板参数（`type: 'composite'`）。
 *
 * 面板绑定哪种特殊组件（`panel`）、面板怎么配置（`config`，含音色列表/子组件标签等）
 * 完全是"这个参数长什么样、怎么交互"，不是"这个参数是什么"——请求构建器只读
 * `default`/当前值本身（一个不透明的 JSON 值），从不关心它是用哪种面板选出来的。
 * 因此 `panel`/`config` 整体划给展示层，运行时侧的复合参数只剩壳。
 */
export interface RuntimeCompositeParamDef extends RuntimeParamDefBase {
  type: 'composite'
}

export interface RuntimeImageUploadParamDef extends RuntimeParamDefBase {
  type: 'image-upload'
  valueType?: 'array'
  maxCount?: number
  format?: 'base64' | 'url'
  base64Prefix?: boolean
  accept?: string[]
  maxSize?: number
  smartMatch?: RuntimeSmartMatchConfig
}

export interface RuntimeVideoUploadParamDef extends RuntimeParamDefBase {
  type: 'video-upload'
  valueType?: 'array'
  maxCount?: number
  accept?: string[]
  maxSize?: number
  maxDuration?: number
  minDuration?: number
}

export interface RuntimeFileUploadParamDef extends RuntimeParamDefBase {
  type: 'file-upload'
  valueType?: 'array'
  maxCount?: number
  accept?: string[]
  maxSize?: number
}

/** resolution 的取值空间：只留预设的 value，label 是展示资产 */
export interface RuntimeResolutionParamDef extends RuntimeParamDefBase {
  type: 'resolution'
  valueType?: 'string'
  presets: Array<{ value: string }>
  allowCustom?: boolean
}

/** aspect-ratio 的取值空间：只留 value，label/icon 是展示资产 */
export interface RuntimeAspectRatioParamDef extends RuntimeParamDefBase {
  type: 'aspect-ratio'
  valueType?: 'string'
  options: Array<{ value: string }>
}

export type RuntimeParamDef =
  | RuntimeTextParamDef
  | RuntimeNumberParamDef
  | RuntimeDropdownParamDef
  | RuntimeSwitchParamDef
  | RuntimeRadioParamDef
  | RuntimePanelParamDef
  | RuntimeCompositeParamDef
  | RuntimeImageUploadParamDef
  | RuntimeVideoUploadParamDef
  | RuntimeFileUploadParamDef
  | RuntimeResolutionParamDef
  | RuntimeAspectRatioParamDef

// ========== 端点 / 请求 / 价格 ==========

export interface RuntimeEndpointRule {
  when: JsonObject
  endpoint: string
}

export type RuntimeEndpointConfig =
  | string
  | {
      rules?: RuntimeEndpointRule[]
      default?: string
      selector?: (params: JsonObject) => string | Promise<string>
      routes?: Record<string, { path: string; method?: string }>
    }

export interface RuntimeRequestConfig {
  base?: Record<string, string>
  preprocess?: (params: JsonObject) => JsonObject
  builder?: (params: JsonObject) => JsonObject | Promise<JsonObject>
}

export interface RuntimeStructuredOutputParserInput {
  status: GenerateStatus
  url: string
  metadata: JsonValue
  params: JsonObject
}

export interface RuntimeResponseConfig {
  /** 模型级响应语义解析；供应商适配器只负责传输与保留原始 metadata。 */
  structuredOutput?: (
    input: RuntimeStructuredOutputParserInput
  ) => StructuredGenerationOutput | undefined
}

/** 计价单位。非货币单位（如魔搭"魔粒"）的换算规则是展示侧的事，这里只搬类型。 */
export type Currency = '¥' | '$' | '€' | '£' | '魔粒'

export type RuntimePricingMediaAggregation = 'first' | 'sum'

export type RuntimePricingMediaMultiplier =
  | {
      kind: 'fixed'
      value: number
      exponent?: number
    }
  | {
      kind: 'parameter'
      paramId: string
      fallback: number
      exponent?: number
    }

interface RuntimePricingMediaContextRequirementBase {
  /** 解析结果写入 calculator params 的字段名。 */
  targetParam: string
  /** 默认只读取第一份素材；sum 可用于多素材总时长、总像素等计价。 */
  aggregation?: RuntimePricingMediaAggregation
  /** 对媒体指标做固定或参数驱动的倍率变换，例如输出 MP = 输入 MP × 放大倍率²。 */
  multiplier?: RuntimePricingMediaMultiplier
}

export type RuntimePricingMediaContextRequirement =
  | (RuntimePricingMediaContextRequirementBase & {
      mediaType: 'image'
      metric: 'megapixels' | 'width' | 'height' | 'fileSizeBytes'
    })
  | (RuntimePricingMediaContextRequirementBase & {
      mediaType: 'video'
      metric: 'durationSeconds' | 'megapixels' | 'width' | 'height'
    })

export interface RuntimePricingConfig {
  currency: Currency
  fixed?: number
  calculator?: (params: JsonObject) => number
  /** 数值是当前参数总价，还是单个计费单位的参考价；缺省保持既有总价语义。 */
  estimateMode?: 'total' | 'unit'
  /** `estimateMode: 'unit'` 时用于展示的计费单位，例如 `MP`。 */
  estimateUnit?: string
  /**
   * calculator 需要宿主从媒体文件补齐的指标。SDK 只声明契约，不读取文件；
   * Web/Electron 等宿主可用各自的媒体探针统一解析并注入。
   */
  mediaContext?: RuntimePricingMediaContextRequirement[]
  /** 价格说明，纯字符串（非 I18nText），历史上一直是这样 */
  description?: string
}

// ========== 输入限制 / 生成前置条件 / 运行时安全网 ==========

export interface RuntimeInputCountLimit {
  min?: number
  max?: number
  exact?: number
}

export interface RuntimeVideoConstraints {
  maxSizeMB?: number
  minDurationSec?: number
  maxDurationSec?: number
  trim?: { maxClipSeconds: number }
}

export interface RuntimeInputLimitRule {
  when?: RuntimeConditionExpression | RuntimeConditionFunction
  images?: RuntimeInputCountLimit
  videos?: RuntimeInputCountLimit
  audios?: RuntimeInputCountLimit
  videoConstraints?: RuntimeVideoConstraints
}

export interface RuntimeInputLimitsConfig {
  images?: RuntimeInputCountLimit
  videos?: RuntimeInputCountLimit
  audios?: RuntimeInputCountLimit
  rules?: RuntimeInputLimitRule[]
}

export type RuntimeInputLimitsResolver = (params: JsonObject) => RuntimeInputLimitsConfig
export type RuntimeInputLimits = RuntimeInputLimitsConfig | RuntimeInputLimitsResolver

/**
 * 生成前置条件的提示文案（`title`/`message`）历史上一直是纯字符串，不是 I18nText——
 * 这是既有产品资产里的一个已知缺口（没有真正做 i18n），不是本任务引入的新问题，
 * 3.1 只是如实保留原样，不在这里顺手"修正"。正因为是纯字符串，整段 requirements
 * 结构反而不依赖 I18nText 类型，可以完整留在运行时侧。
 */
export interface RuntimeRequirementMessage {
  title: string
  message: string
  type?: 'info' | 'warning' | 'error'
}

export interface RuntimeRequirementCount {
  min?: number
  max?: number
  exact?: number
}

export interface RuntimeGenerationRequirement {
  id?: string
  when?: RuntimeConditionExpression | RuntimeConditionFunction
  require?: {
    prompt?: boolean
    images?: RuntimeRequirementCount
    videos?: RuntimeRequirementCount
  }
  message: RuntimeRequirementMessage
}

export type RuntimeConstraintValue = string | number | boolean

export interface RuntimeNumberFieldConstraint {
  field: string
  min?: number
  max?: number
  integer?: boolean
  fallback?: number
}

export interface RuntimeEnumFieldConstraint {
  field: string
  allowed: RuntimeConstraintValue[]
  fallback?: RuntimeConstraintValue
}

export interface RuntimeImageSizeFieldConstraint {
  field: string
  format?: 'string' | 'object'
  widthKey?: string
  heightKey?: string
  minSide?: number
  maxSide?: number
  minPixels?: number
  maxPixels: number
  minAspectRatio?: number
  maxAspectRatio?: number
}

export type RuntimeMediaFieldKind = 'image' | 'video' | 'audio' | 'file'

export interface RuntimeMediaFieldConstraint {
  field: string
  kind: RuntimeMediaFieldKind
}

export interface RuntimeConstraints {
  numberFields?: RuntimeNumberFieldConstraint[]
  enumFields?: RuntimeEnumFieldConstraint[]
  imageSizeFields?: RuntimeImageSizeFieldConstraint[]
  mediaFields?: RuntimeMediaFieldConstraint[]
}

// ========== 模型运行时定义（顶层契约） ==========

export interface ModelRuntimeDefinition {
  meta: ModelRuntimeMeta

  /**
   * 是否接受生成协议共享的 `prompt` 文本输入。为兼容既有模型与第三方定义，缺省视为 `true`；
   * 纯媒体工具必须显式设为 `false`，避免能力发现把它们误报为可接收文本。
   */
  acceptsPrompt?: boolean

  params: RuntimeParamDef[]

  /** 生成前置条件（可选） */
  requirements?: RuntimeGenerationRequirement[]

  /** 上传数量/时长限制（可选） */
  inputLimits?: RuntimeInputLimits

  /** 可以独立构成一次生成输入的自定义参数 ID（如"父任务 ID"） */
  alternativeInputParamIds?: string[]

  /** 请求体构建后的运行时安全网约束 */
  runtimeConstraints?: RuntimeConstraints

  /** 端点选择配置 */
  endpoints: RuntimeEndpointConfig

  /** 请求构建配置（可选，不提供则使用默认字段映射） */
  request?: RuntimeRequestConfig

  /** 可选的模型级响应语义；禁止在 UI/provider 通过 modelId 分支补解析。 */
  response?: RuntimeResponseConfig

  /** 价格配置 */
  pricing: RuntimePricingConfig
}
