/**
 * 参数定义核心类型
 *
 * 定义所有参数组件的类型和配置
 */

import { I18nText } from './I18nText'
import { ComponentType, ValueType } from './ComponentTypes'
import type { SocketType } from './SocketType'
import type { ApiConfig, ApiTransform } from './ApiMapping'
import { VisibleCondition, DisabledCondition, SmartMatchConfig } from './ConditionTypes'
import type {
  PanelType,
  ResolutionPanelConfig,
  VoiceSelectorConfig,
  CustomPanelConfig
} from './PanelTypes'
import type { CompositePanelConfig as CompositeLayoutConfig } from './CompositePanel'

/**
 * 基础参数定义
 *
 * 所有参数类型的共同字段
 */
export interface BaseParamDef {
  /**
   * 参数唯一标识符
   *
   * @example "duration", "aspectRatio", "numImages"
   */
  id: string

  /**
   * 组件类型
   */
  type: ComponentType

  /**
   * 参数显示顺序
   *
   * 数值越小越靠前
   */
  order: number

  /**
   * 参数名称（支持国际化）
   *
   * @example { zh: "时长", en: "Duration" }
   */
  name: I18nText

  /**
   * 参数说明（可选，支持国际化）
   *
   * 鼠标悬停时显示
   */
  tooltip?: I18nText

  /**
   * 详细描述（可选，支持国际化）
   *
   * 在组件下方显示具体说明
   */
  description?: I18nText

  /**
   * 是否必填（默认 false）
   */
  required?: boolean

  /**
   * 值类型
   */
  valueType?: ValueType

  /**
   * 默认值
   */
  default: DynamicValue

  /**
   * API 映射配置（可选）
   *
   * 如果不提供，则不映射到 API
   */
  api?: ApiConfig

  /** Legacy shorthand for API field mapping (equivalent to api: 'field') */
  apiField?: string

  /** Legacy shorthand for API transform */
  apiTransform?: ApiTransform

  /** Legacy endpoint-specific mapping */
  apiMapping?: Record<string, { transform: ApiTransform }>

  /**
   * 跨模型切换时的参数语义标识（可选）。
   *
   * 通用参数会根据 id、apiField 与选项自动识别；只有命名差异较大或需要明确
   * 建立对应关系时才需要填写。相同 transferKey 的参数会在目标 schema 校验后迁移。
   */
  transferKey?: string

  /**
   * 显示条件（可选）
   *
   * 控制参数是否显示
   */
  visible?: VisibleCondition

  /**
   * 禁用条件（可选）
   *
   * 控制参数是否禁用
   */
  disabled?: DisabledCondition

  /**
   * 画布插槽类型覆盖（可选）
   *
   * 缺省时由 deriveSocketType 从 type/valueType 自动推导；
   * 仅在需要特殊连接语义（如细化 INT/FLOAT）时显式声明。
   */
  socketType?: SocketType
}

// ========== 基础组件参数 ==========

/**
 * 文本输入框参数
 *
 * @example
 * ```typescript
 * {
 *   id: 'prompt',
 *   component: 'text',
 *   order: 1,
 *   name: { zh: '提示词', en: 'Prompt' },
 *   valueType: 'string',
 *   default: '',
 *   placeholder: { zh: '描述想要生成的内容', en: 'Describe what you want to generate' },
 *   multiline: true,
 *   maxLength: 1000,
 *   api: 'prompt'
 * }
 * ```
 */
export interface TextParamEditorVariableDef {
  key: string
  label: I18nText
  group?: I18nText
  description?: I18nText
}

export interface TextParamEditorConfig {
  kind: 'prompt'
  preset?: 'plain' | 'template-variables'
  variables?: TextParamEditorVariableDef[]
}

export interface TextParamDef extends BaseParamDef {
  type: 'text' | 'textarea'
  valueType?: 'string'

  /**
   * 占位符文本（可选）
   */
  placeholder?: I18nText

  /**
   * 是否多行（默认 false）
   */
  multiline?: boolean

  /**
   * 最大长度（可选）
   */
  maxLength?: number

  /**
   * 是否必需（默认 false）
   */
  required?: boolean

  /**
   * 行数（仅多行时有效，默认 4）
   */
  rows?: number

  /** 由 schema 声明使用共享提示词编辑器；未配置时继续使用原生文本 primitive。 */
  editor?: TextParamEditorConfig
}

/**
 * 数字输入框参数
 *
 * @example
 * ```typescript
 * {
 *   id: 'seed',
 *   component: 'number',
 *   order: 10,
 *   name: { zh: '随机种子', en: 'Seed' },
 *   valueType: 'number',
 *   default: -1,
 *   min: -1,
 *   max: 999999999,
 *   placeholder: { zh: '-1 表示随机', en: '-1 for random' },
 *   api: 'seed'
 * }
 * ```
 */
export interface NumberParamDef extends BaseParamDef {
  type: 'number'
  valueType?: 'number'

  /**
   * 最小值（可选）
   */
  min?: number

  /**
   * 最大值（可选）
   */
  max?: number

  /**
   * 步长（可选）
   */
  step?: number

  /**
   * 占位符（可选）
   */
  placeholder?: I18nText

  /**
   * 单位（可选）
   *
   * @example "秒", "张", "%"
   */
  unit?: string

  /**
   * 刻度标记（可选）
   */
  marks?: Array<{ value: number; label: string }>

  /**
   * 是否显示输入框（默认 true）
   */
  showInput?: boolean
}

/**
 * 下拉选择参数
 *
 * @example
 * ```typescript
 * {
 *   id: 'aspectRatio',
 *   component: 'dropdown',
 *   order: 3,
 *   name: { zh: '宽高比', en: 'Aspect Ratio' },
 *   valueType: 'string',
 *   default: '16:9',
 *   options: [
 *     { value: '16:9', label: '16:9 (横屏)' },
 *     { value: '9:16', label: '9:16 (竖屏)' },
 *     { value: '1:1', label: '1:1 (方形)' }
 *   ],
 *   api: 'aspect_ratio'
 * }
 * ```
 */
export interface DropdownParamDef extends BaseParamDef {
  type: 'dropdown'
  valueType?: 'string' | 'number'

  /**
   * 选项列表
   */
  options: Array<{
    /**
     * 选项值
     */
    value: string | number

    /**
     * 选项标签（支持国际化）
     */
    label: I18nText

    /**
     * 选项说明（可选）
     */
    description?: I18nText

    /**
     * 选项是否禁用（可选）
     */
    disabled?: boolean
  }>

  /**
   * 是否可搜索（默认 false）
   */
  searchable?: boolean

  /**
   * 占位符（可选）
   */
  placeholder?: I18nText
}

/**
 * 开关参数
 *
 * @example
 * ```typescript
 * {
 *   id: 'generateAudio',
 *   component: 'switch',
 *   order: 5,
 *   name: { zh: '生成音频', en: 'Generate Audio' },
 *   tooltip: { zh: '为视频生成背景音乐', en: 'Generate background music for video' },
 *   valueType: 'boolean',
 *   default: false,
 *   api: 'audio'
 * }
 * ```
 */
export interface SwitchParamDef extends BaseParamDef {
  type: 'switch'
  valueType?: 'boolean'

  /**
   * 开启时的标签（可选）
   */
  onLabel?: I18nText

  /**
   * 关闭时的标签（可选）
   */
  offLabel?: I18nText
}

/**
 * 单选按钮组参数
 *
 * @example
 * ```typescript
 * {
 *   id: 'mode',
 *   component: 'radio',
 *   order: 1,
 *   name: { zh: '模式', en: 'Mode' },
 *   valueType: 'string',
 *   default: 'text-to-video',
 *   options: [
 *     { value: 'text-to-video', label: { zh: '文生视频', en: 'Text to Video' } },
 *     { value: 'image-to-video', label: { zh: '图生视频', en: 'Image to Video' } }
 *   ],
 *   direction: 'horizontal',
 *   api: 'mode'
 * }
 * ```
 */
export interface RadioParamDef extends BaseParamDef {
  type: 'radio'
  valueType?: 'string' | 'number'

  /**
   * 选项列表
   */
  options: Array<{
    value: string | number
    label: I18nText
    description?: I18nText
    disabled?: boolean
  }>

  /**
   * 排列方向（默认 'vertical'）
   */
  direction?: 'horizontal' | 'vertical'
}

// ========== 复合组件参数 ==========

/**
 * 参数面板（用于分组）
 *
 * @example
 * ```typescript
 * {
 *   id: 'advancedSettings',
 *   component: 'panel',
 *   order: 100,
 *   name: { zh: '高级设置', en: 'Advanced Settings' },
 *   valueType: 'object',
 *   default: {},
 *   collapsible: true,
 *   defaultCollapsed: true,
 *   children: [
 *     // 子参数定义...
 *   ]
 * }
 * ```
 */
export interface PanelParamDef extends BaseParamDef {
  type: 'panel'
  valueType?: 'object'

  /**
   * 子参数列表
   */
  children: ParamDef[]

  /**
   * 是否可折叠（默认 false）
   */
  collapsible?: boolean

  /**
   * 默认是否折叠（默认 false）
   */
  defaultCollapsed?: boolean
}

/**
 * 复合面板参数
 *
 * 支持通过面板注册中心渲染特殊面板
 */
export interface CompositePanelDef extends BaseParamDef {
  type: 'composite'
  valueType?: ValueType

  /**
   * 绑定的面板类型（可选）
   */
  panel?: PanelType

  /**
   * 面板配置（可选）
   */
  config?: ResolutionPanelConfig | VoiceSelectorConfig | CompositeLayoutConfig | CustomPanelConfig
}

/**
 * 图片上传参数
 *
 * @example
 * ```typescript
 * {
 *   id: 'images',
 *   component: 'image-upload',
 *   order: 10,
 *   name: { zh: '图片', en: 'Images' },
 *   valueType: 'array',
 *   default: [],
 *   maxCount: 1,
 *   accept: ['image/png', 'image/jpeg', 'image/webp'],
 *   maxSize: 10 * 1024 * 1024,  // 10MB
 *   smartMatch: {
 *     targetParam: 'aspectRatio',
 *     matcher: (file) => {
 *       const ratio = file.dimensions.width / file.dimensions.height
 *       if (ratio > 1.5) return '16:9'
 *       if (ratio < 0.7) return '9:16'
 *       return '1:1'
 *     }
 *   },
 *   api: 'image_urls'
 * }
 * ```
 */
export interface ImageUploadParamDef extends BaseParamDef {
  type: 'image-upload'
  valueType?: 'array'

  /**
   * 最大上传数量（默认 1）
   */
  maxCount?: number

  /**
   * 上传格式
   * 'base64' - 返回 base64 字符串
   * 'url' - 返回图片 URL (需要适配器支持文件上传)
   */
  format?: 'base64' | 'url'

  /**
   * base64 格式是否包含前缀 (data:image/...)
   */
  base64Prefix?: boolean

  /**
   * 接受的文件类型（可选）
   */
  accept?: string[]

  /**
   * 最大文件大小（字节，可选）
   */
  maxSize?: number

  /**
   * 智能匹配配置（可选）
   */
  smartMatch?: SmartMatchConfig

  /**
   * 上传按钮文本（可选）
   */
  uploadButtonText?: I18nText
}

/** 不带媒体预览的通用文件上传参数（例如 PDF 上下文）。 */
export interface FileUploadParamDef extends BaseParamDef {
  type: 'file-upload'
  valueType?: 'array'
  maxCount?: number
  accept?: string[]
  maxSize?: number
  uploadButtonText?: I18nText
}

/**
 * 视频上传参数
 *
 * @example
 * ```typescript
 * {
 *   id: 'referenceVideo',
 *   component: 'video-upload',
 *   order: 11,
 *   name: { zh: '参考视频', en: 'Reference Video' },
 *   valueType: 'array',
 *   default: [],
 *   maxCount: 1,
 *   maxDuration: 30,
 *   minDuration: 3,
 *   accept: ['video/mp4', 'video/webm'],
 *   visible: {
 *     condition: 'mode === "motion-control"'
 *   },
 *   api: 'reference_video_url'
 * }
 * ```
 */
export interface VideoUploadParamDef extends BaseParamDef {
  type: 'video-upload'
  valueType?: 'array'

  /**
   * 最大上传数量（默认 1）
   */
  maxCount?: number

  /**
   * 接受的文件类型（可选）
   */
  accept?: string[]

  /**
   * 最大文件大小（字节，可选）
   */
  maxSize?: number

  /**
   * 最大时长（秒，可选）
   */
  maxDuration?: number

  /**
   * 最小时长（秒，可选）
   */
  minDuration?: number

  /**
   * 上传按钮文本（可选）
   */
  uploadButtonText?: I18nText
}

// ========== 特殊组件参数 ==========

/**
 * 分辨率选择器参数
 *
 * @example
 * ```typescript
 * {
 *   id: 'resolution',
 *   component: 'resolution',
 *   order: 4,
 *   name: { zh: '分辨率', en: 'Resolution' },
 *   valueType: 'string',
 *   default: '1920x1080',
 *   presets: [
 *     { value: '1920x1080', label: '1080p (16:9)' },
 *     { value: '1280x720', label: '720p (16:9)' },
 *     { value: '3840x2160', label: '4K (16:9)' }
 *   ],
 *   allowCustom: true,
 *   api: {
 *     transform: (value) => {
 *       const [width, height] = value.split('x').map(Number)
 *       return { width, height }
 *     }
 *   }
 * }
 * ```
 */
export interface ResolutionParamDef extends BaseParamDef {
  type: 'resolution'
  valueType?: 'string'

  /**
   * 预设分辨率列表
   */
  presets: Array<{
    value: string
    label: I18nText
  }>

  /**
   * 是否允许自定义（默认 false）
   */
  allowCustom?: boolean
}

/**
 * 宽高比选择器参数
 *
 * @example
 * ```typescript
 * {
 *   id: 'aspectRatio',
 *   component: 'aspect-ratio',
 *   order: 3,
 *   name: { zh: '宽高比', en: 'Aspect Ratio' },
 *   valueType: 'string',
 *   default: '16:9',
 *   options: [
 *     { value: '16:9', label: '16:9', icon: '□' },
 *     { value: '9:16', label: '9:16', icon: '▭' },
 *     { value: '1:1', label: '1:1', icon: '■' }
 *   ],
 *   api: 'aspect_ratio'
 * }
 * ```
 */
export interface AspectRatioParamDef extends BaseParamDef {
  type: 'aspect-ratio'
  valueType?: 'string'

  /**
   * 宽高比选项
   */
  options: Array<{
    value: string
    label: string
    icon?: string
  }>
}

// ========== 参数定义联合类型 ==========

/**
 * 参数定义（所有类型的联合）
 *
 * 使用 discriminated union 确保类型安全
 */
export type ParamDef =
  | TextParamDef
  | NumberParamDef
  | DropdownParamDef
  | SwitchParamDef
  | RadioParamDef
  | PanelParamDef
  | CompositePanelDef
  | ImageUploadParamDef
  | VideoUploadParamDef
  | FileUploadParamDef
  | ResolutionParamDef
  | AspectRatioParamDef
