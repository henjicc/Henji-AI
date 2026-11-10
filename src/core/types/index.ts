/**
 * 核心类型导出
 *
 * 统一导出所有核心类型定义
 */

// 国际化文本
export type { I18nText } from './I18nText'
export { getI18nText } from './I18nText'

// 模型标签
export type { ModelTag } from './ModelTags'

// 端点配置
export type {
  EndpointConfig,
  RouteDefinition
} from './EndpointConfig'

// 请求配置
export type { RequestConfig } from './RequestConfig'

// 价格配置
export type {
  PricingConfig
} from './PricingConfig'

// 组件类型
export type { ComponentType, ValueType } from './ComponentTypes'

// 插槽类型系统
export type { SocketType } from './SocketType'
export { deriveSocketType, isSocketCompatible, getSocketColor } from './SocketType'

// API 映射
export type {
  ApiTransform,
  ApiConfig
} from './ApiMapping'

// 条件类型
export type {
  ConditionExpression,
  ConditionFunction,
  VisibleCondition,
  DisabledCondition,
  SmartMatchConfig
} from './ConditionTypes'

// 输入限制
export type {
  InputLimits,
  InputLimitsConfig,
  InputLimitRule,
  InputCountLimit,
  ImageConstraints,
  VideoConstraints
} from './InputLimits'

// 生成要求
export type {
  GenerationRequirement,
  RequirementMessage
} from './GenerationRequirements'

// 运行时约束
export type {
  RuntimeConstraints
} from './RuntimeConstraints'

// 参数定义
export type {
  ParamDef,
  BaseParamDef,
  TextParamDef,
  NumberParamDef,
  DropdownParamDef,
  SwitchParamDef,
  RadioParamDef,
  PanelParamDef,
  CompositePanelDef,
  ImageUploadParamDef,
  VideoUploadParamDef,
  FileUploadParamDef,
  ResolutionParamDef,
  AspectRatioParamDef
} from './ParamDef'

// 联动系统
export type {
  Linkage,
  LinkageArray,
  LinkageEffect
} from './Linkage'

// 模型定义（核心）
export type {
  ModelDefinition,
  ModelDefinitionMap,
  ModelMeta,
  BuiltinModelType,
  ModelType,
  ProviderId,
  ModelParamPresentation,
  ParamPresentationGroup,
  ParamPresentationSection,
  ProgressConfig,
  ProgressCurveConfig
} from './ModelDefinition'

// 面板类型
export type {
  PanelType,
  ResolutionPanelConfig,
  VoiceSelectorConfig,
  CustomPanelConfig,
  SpecialPanelConfig
} from './PanelTypes'

// 预设类型
export type {
  Preset,
  CreatePresetInput,
  UpdatePresetInput,
  PresetQueryOptions
} from './Preset'

export type { AiRuntimeTrace } from './AiRuntimeTrace'
