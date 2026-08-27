/**
 * 模型展示契约：痕迹AI 侧「模型长什么样」——i18n 文案、面板布局、联动关系、图标。
 *
 * 与 SDK 侧 `ModelRuntimeDefinition`（`@henjicc/ai-sdk` 的 `packages/ai-sdk/src/types/model.ts`）
 * 配对使用，两者用 `composeModelDefinition` 合成回现有 `ModelDefinition`。归属口径见
 * docs/task/模型SDK抽离/重要记录.md 记录 003（本文件是任务 3.1 的落地）。
 *
 * `ParamPresentationEntry` 按参数 `id` 关联到运行时定义里的同名参数，只携带该参数
 * "怎么显示、怎么交互"的字段；参数的取值契约（type/default/options[].value/min/max/
 * step/order/条件显隐）由运行时定义负责，这里绝不重复声明会漂移的第二份取值信息。
 */

import type { I18nText } from './I18nText'
import type { Linkage } from './Linkage'
import type { ModelParamPresentation } from './ModelDefinition'
import type { TextParamEditorConfig } from './ParamDef'
import type { SocketType } from './SocketType'
import type {
  PanelType,
  ResolutionPanelConfig,
  VoiceSelectorConfig,
  MinimaxVoiceClonePanelConfig,
  CustomPanelConfig,
} from './PanelTypes'
import type { CompositePanelConfig as CompositeLayoutConfig } from './CompositePanel'

/** dropdown/radio 单个选项的展示文案，按 `RuntimeSelectOption.value` 关联。 */
export interface ParamOptionPresentation {
  label: I18nText
  description?: I18nText
}

/**
 * 单个参数的展示补丁。字段全部可选——一个参数用到哪些字段完全由它的组件类型决定，
 * 运行时侧的 discriminated union 到这里合并成了宽松的可选字段集合，因为展示补丁是
 * 按 `paramId` 关联的旁路数据，不需要（也不应该）在类型层重建一份参数类型判别。
 */
export interface ParamPresentationEntry {
  /** 参数名称（必填：`composeModelDefinition` 会用它填充 `ParamDef.name`） */
  name: I18nText
  tooltip?: I18nText
  description?: I18nText
  placeholder?: I18nText

  /** 产品角色（渠道/模式选择器排序约定），见 modelParamConventionValidator */
  role?: 'channel' | 'mode'

  /** 画布插槽类型覆盖，缺省由 deriveSocketType 从 type/valueType 推导 */
  socketType?: SocketType

  // ---- text / textarea ----
  multiline?: boolean
  rows?: number
  editor?: TextParamEditorConfig

  // ---- number ----
  unit?: string
  marks?: Array<{ value: number; label: string }>
  showInput?: boolean

  // ---- dropdown / radio：按选项 value 找回文案 ----
  optionLabels?: Record<string, ParamOptionPresentation>
  searchable?: boolean
  direction?: 'horizontal' | 'vertical'

  // ---- switch ----
  onLabel?: I18nText
  offLabel?: I18nText

  // ---- image-upload / video-upload / file-upload ----
  uploadButtonText?: I18nText

  // ---- panel（分组容器）----
  collapsible?: boolean
  defaultCollapsed?: boolean

  /**
   * ---- composite（复合面板）----
   * 面板绑定哪种特殊组件、面板怎么配置完全是展示层的事：运行时侧的 composite 参数
   * 只留一个取值壳（id/default/api），`panel`/`config` 整体在这里补回来。
   */
  panel?: PanelType
  config?:
    | ResolutionPanelConfig
    | VoiceSelectorConfig
    | MinimaxVoiceClonePanelConfig
    | CompositeLayoutConfig
    | CustomPanelConfig

  // ---- resolution：按预设 value 找回标签 ----
  presetLabels?: Record<string, I18nText>

  /**
   * ---- aspect-ratio：按 value 找回标签/图标 ----
   * 历史遗留：`AspectRatioParamDef.options[].label` 一直是纯字符串，不是 I18nText，
   * 这里如实保留，不在 3.1 顺手"修正"成 I18nText。
   */
  aspectRatioDisplay?: Record<string, { label: string; icon?: string }>
}

export interface ModelPresentationMeta {
  /** 模型名称（支持国际化） */
  name: I18nText

  /** 模型图标 URL（可选） */
  icon?: string

  /** i18n 作用域：用于模型内短 key 的自动前缀拼接 */
  i18nScope?: string
}

export interface ModelPresentation {
  meta: ModelPresentationMeta

  /** 按参数 id 关联的展示补丁；运行时定义里的每个参数都必须能在这里找到同名条目。 */
  params: Record<string, ParamPresentationEntry>

  /** 参数的纯展示编排（可选），只重排已有扁平参数，不改变参数 ID/值结构/请求字段 */
  paramPresentation?: ModelParamPresentation

  /** 参数联动规则（可选） */
  linkages?: Linkage[]
}
