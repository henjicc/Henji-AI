/**
 * 核心类型导出
 *
 * 统一导出所有核心类型定义
 */

// 国际化文本
export type { I18nText } from './I18nText'
export { getI18nText } from './I18nText'

// 模型标签
export type { ModelTag, ModelTagConfig } from './ModelTags'
export { TAG_CATEGORIES, TAG_DESCRIPTIONS } from './ModelTags'

// 端点配置
export type {
  EndpointConfig,
  EndpointRule,
  RouteDefinition
} from './EndpointConfig'

// 请求配置
export type { RequestConfig } from './RequestConfig'

// 价格配置
export type {
  PricingConfig,
  Currency
} from './PricingConfig'

// 组件类型
export type { ComponentType, ValueType } from './ComponentTypes'

// API 映射
export type {
  ApiFieldMapping,
  ApiTransform,
  ApiMapping,
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

// 参数定义
export type {
  ParamDef,
  BaseParamDef,
  TextParamDef,
  NumberParamDef,
  SliderParamDef,
  DropdownParamDef,
  SwitchParamDef,
  RadioParamDef,
  PanelParamDef,
  CompositePanelDef,
  ImageUploadParamDef,
  VideoUploadParamDef,
  ResolutionParamDef,
  AspectRatioParamDef
} from './ParamDef'

// 联动系统
export type {
  Linkage,
  LinkageArray,
  LinkageEffect,
  BaseLinkage,
  ResetLinkage,
  FilterOptionsLinkage,
  FilterRangeLinkage,
  SetValueLinkage,
  AutoSwitchLinkage,
  DisableLinkage,
  HideLinkage,
  CustomLinkage
} from './Linkage'

// 模型定义（核心）
export type {
  ModelDefinition,
  ModelDefinitionMap,
  ModelMeta,
  ModelType,
  ProviderId
} from './ModelDefinition'

// 面板类型
export type {
  PanelType,
  TriggerStyle,
  PanelAlignment,
  ResolutionPanelConfig,
  VoiceSelectorConfig,
  CompositePanelConfig,
  CustomPanelConfig,
  SpecialPanelConfig
} from './PanelTypes'

// 预设类型
export type {
  Preset,
  PresetParams,
  CreatePresetInput,
  UpdatePresetInput,
  PresetQueryOptions
} from './Preset'

// 节点系统类型
export type {
  PortDataType,
  InputPort,
  OutputPort
} from './NodePort'

export type {
  NodeOutput,
  ExecutionContext,
  NodeExecutor,
  ModelNode
} from './ModelNode'

export type {
  ToolNodeType,
  ToolNode
} from './ToolNode'

export type {
  INodeConverter
} from './NodeConverter'

export type {
  NodeConnection
} from './NodeConnection'

export type {
  Workflow
} from './Workflow'

export type {
  ToolNodeCategory,
  ToolNodeDefinition
} from './ToolNodeDefinition'
