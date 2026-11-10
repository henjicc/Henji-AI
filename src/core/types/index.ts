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
  EndpointConfig
} from './EndpointConfig'

// 条件类型
export type {
  ConditionExpression,
  ConditionFunction
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

// 参数定义
export type {
  ParamDef,
  TextParamDef,
  NumberParamDef,
  DropdownParamDef,
  SwitchParamDef,
  RadioParamDef,
  CompositePanelDef,
  ImageUploadParamDef,
  VideoUploadParamDef,
  FileUploadParamDef,
  AspectRatioParamDef
} from './ParamDef'

// 联动系统
export type {
  Linkage
} from './Linkage'

// 模型定义（核心）
export type {
  ModelDefinition,
  BuiltinModelType,
  ModelType,
  ProviderId,
  ModelParamPresentation,
  ParamPresentationGroup,
  ParamPresentationSection,
  ProgressConfig,
  ProgressCurveConfig
} from './ModelDefinition'

export type { AiRuntimeTrace } from './AiRuntimeTrace'
