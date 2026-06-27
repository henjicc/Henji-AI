/**
 * 联动系统类型定义
 *
 * 定义参数之间的联动关系和效果
 */

/**
 * 联动效果类型
 *
 * 定义了所有支持的联动效果
 */
export type LinkageEffect =
  | 'reset'           // 重置参数值
  | 'filterOptions'   // 过滤下拉选项
  | 'filterRange'     // 过滤数值范围
  | 'setValue'        // 设置参数值
  | 'autoSwitch'      // 自动切换值
  | 'disable'         // 禁用参数
  | 'hide'            // 隐藏参数
  | 'custom'          // 自定义处理

/**
 * Value used by linkage actions when providing a fixed value.
 *
 * Intentionally avoids `any` so function expressions get contextual typing under `strict`.
 */
export type LinkageValue = string | number | boolean | null | undefined | object

/**
 * 基础联动接口
 *
 * 所有联动类型的共同字段
 */
export interface BaseLinkage {
  /**
   * 触发器参数ID
   *
   * 支持单个参数或多个参数
   * 支持嵌套路径（如 'resolution.quality'）
   *
   * @example "mode"
   * @example ["mode", "fastMode"]
   * @example "resolution.quality"
   */
  trigger: string | string[]

  /**
   * 联动效果类型
   */
  effect: LinkageEffect

  /**
   * 优先级（可选）
   *
   * 数值越小优先级越高
   * 如果不提供，使用默认优先级
   *
   * @default 根据 effect 类型自动分配
   */
  priority?: number

  /**
   * 防抖延迟（毫秒，可选）
   *
   * 用于避免频繁触发
   *
   * @default 0
   */
  debounce?: number

  /**
   * 联动说明（可选，用于调试）
   */
  description?: string
}

// ========== 具体联动类型 ==========

/**
 * 重置联动
 *
 * 当触发器参数改变时，重置目标参数为默认值
 *
 * @example
 * ```typescript
 * {
 *   trigger: 'mode',
 *   effect: 'reset',
 *   targets: ['images', 'videos'],
 *   description: '切换模式时清空上传的文件'
 * }
 * ```
 */
export interface ResetLinkage extends BaseLinkage {
  effect: 'reset'

  /**
   * 目标参数ID列表
   *
   * 支持嵌套路径
   */
  targets: string[]

  /**
   * 重置条件（可选）
   *
   * 如果不提供，总是重置
   *
   * @param triggerValue - 触发器参数的新值
   * @param allParams - 所有参数的当前值
   * @returns 是否执行重置
   */
  condition?: (triggerValue: DynamicValue, allParams: DynamicValueMap) => boolean
}

/**
 * 过滤选项联动
 *
 * 动态过滤下拉选择或单选按钮的选项列表
 *
 * @example
 * ```typescript
 * {
 *   trigger: 'resolution.quality',
 *   effect: 'filterOptions',
 *   target: 'duration',
 *   filter: (quality, options) => {
 *     if (quality === '1080P') {
 *       // 1080P 只支持 5-10 秒
 *       return options.filter(o => o.value >= 5 && o.value <= 10)
 *     }
 *     return options
 *   }
 * }
 * ```
 */
export interface FilterOptionsLinkage extends BaseLinkage {
  effect: 'filterOptions'

  /**
   * 目标参数ID（必须是 dropdown 或 radio 类型）
   */
  target: string

  /**
   * 过滤函数
   *
   * @param triggerValue - 触发器参数的当前值
   * @param options - 原始选项列表
   * @param allParams - 所有参数的当前值
   * @returns 过滤后的选项列表
   */
  filter: (
    triggerValue: DynamicValue,
    options: Array<{ value: DynamicValue; label: DynamicValue; [key: string]: DynamicValue }>,
    allParams: DynamicValueMap
  ) => Array<{ value: DynamicValue; label: DynamicValue; [key: string]: DynamicValue }>
}

/**
 * 过滤范围联动
 *
 * 动态调整数值参数的 min/max/step
 *
 * @example
 * ```typescript
 * {
 *   trigger: 'fastMode',
 *   effect: 'filterRange',
 *   target: 'duration',
 *   filter: (fastMode) => {
 *     if (fastMode) {
 *       // 快速模式下时长限制为 5 秒
 *       return { min: 5, max: 5, step: 5 }
 *     }
 *     return { min: 5, max: 15, step: 5 }
 *   }
 * }
 * ```
 */
export interface FilterRangeLinkage extends BaseLinkage {
  effect: 'filterRange'

  /**
   * 目标参数ID（必须是 number 类型）
   */
  target: string

  /**
   * 范围过滤函数
   *
   * @param triggerValue - 触发器参数的当前值
   * @param allParams - 所有参数的当前值
   * @returns 新的范围配置
   */
  filter: (
    triggerValue: DynamicValue,
    allParams: DynamicValueMap
  ) => {
    min?: number
    max?: number
    step?: number
  }
}

/**
 * 设置值联动
 *
 * 根据触发器参数的值，设置目标参数的值
 *
 * @example
 * ```typescript
 * {
 *   trigger: 'fastMode',
 *   effect: 'setValue',
 *   target: 'cfgScale',
 *   value: (fastMode) => fastMode ? 0.5 : 1.0,
 *   description: '快速模式下自动降低 CFG 系数'
 * }
 * ```
 */
export interface SetValueLinkage extends BaseLinkage {
  effect: 'setValue'

  /**
   * 目标参数ID
   */
  target: string

  /**
   * 新值（固定值或计算函数）
   */
  value: LinkageValue | ((triggerValue: DynamicValue, allParams: DynamicValueMap) => LinkageValue)

  /**
   * 设置条件（可选）
   *
   * 如果不提供，总是设置
   */
  condition?: (triggerValue: DynamicValue, allParams: DynamicValueMap) => boolean
}

/**
 * 自动切换联动
 *
 * 满足条件时自动切换参数值，条件不满足时恢复原值
 *
 * @example
 * ```typescript
 * {
 *   trigger: 'images',
 *   effect: 'autoSwitch',
 *   target: 'mode',
 *   condition: (images) => images?.length > 0,
 *   value: 'image-to-video',
 *   noRestore: false,
 *   description: '上传图片后自动切换为图生视频模式'
 * }
 * ```
 */
export interface AutoSwitchLinkage extends BaseLinkage {
  effect: 'autoSwitch'

  /**
   * 目标参数ID
   */
  target: string

  /**
   * 切换条件
   *
   * @param triggerValue - 触发器参数的当前值
   * @param allParams - 所有参数的当前值
   * @returns 是否执行切换
   */
  condition: (triggerValue: DynamicValue, allParams: DynamicValueMap) => boolean

  /**
   * 切换后的值（固定值或计算函数）
   */
  value: LinkageValue | ((triggerValue: DynamicValue, allParams: DynamicValueMap) => LinkageValue)

  /**
   * 不恢复原值（默认 false）
   *
   * false: 条件不满足时恢复为切换前的值
   * true: 条件不满足时不恢复
   */
  noRestore?: boolean

  /**
   * 原值保存键（可选）
   *
   * 用于在多个 autoSwitch 之间区分保存的原值
   * 如果不提供，使用默认键
   */
  restoreKey?: string
}

/**
 * 禁用联动
 *
 * 根据条件禁用目标参数
 *
 * @example
 * ```typescript
 * {
 *   trigger: 'fastMode',
 *   effect: 'disable',
 *   targets: ['cfgScale', 'seed'],
 *   condition: (fastMode) => fastMode === true,
 *   reason: '快速模式下不可调整高级参数'
 * }
 * ```
 */
export interface DisableLinkage extends BaseLinkage {
  effect: 'disable'

  /**
   * 目标参数ID列表
   */
  targets: string[]

  /**
   * 禁用条件
   *
   * @param triggerValue - 触发器参数的当前值
   * @param allParams - 所有参数的当前值
   * @returns 是否禁用
   */
  condition: (triggerValue: DynamicValue, allParams: DynamicValueMap) => boolean

  /**
   * 禁用原因（可选）
   *
   * 显示给用户的提示信息
   */
  reason?: string
}

/**
 * 隐藏联动
 *
 * 根据条件隐藏目标参数
 *
 * @example
 * ```typescript
 * {
 *   trigger: 'mode',
 *   effect: 'hide',
 *   targets: ['images'],
 *   condition: (mode) => mode === 'text-to-video',
 *   description: '文生视频模式下隐藏图片上传'
 * }
 * ```
 */
export interface HideLinkage extends BaseLinkage {
  effect: 'hide'

  /**
   * 目标参数ID列表
   */
  targets: string[]

  /**
   * 隐藏条件
   *
   * @param triggerValue - 触发器参数的当前值
   * @param allParams - 所有参数的当前值
   * @returns 是否隐藏
   */
  condition: (triggerValue: DynamicValue, allParams: DynamicValueMap) => boolean
}

/**
 * 自定义联动
 *
 * 完全自定义的联动逻辑
 *
 * @example
 * ```typescript
 * {
 *   trigger: 'resolution',
 *   effect: 'custom',
 *   handler: (triggerValue, allParams, updateParam) => {
 *     // 自定义逻辑：根据分辨率自动调整多个参数
 *     const [width, height] = triggerValue.split('x').map(Number)
 *     if (width * height > 1920 * 1080) {
 *       updateParam('duration', 5)  // 高分辨率只支持 5 秒
 *       updateParam('fastMode', false)  // 禁用快速模式
 *     }
 *   }
 * }
 * ```
 */
export interface CustomLinkage extends BaseLinkage {
  effect: 'custom'

  /**
   * 自定义处理函数
   *
   * @param triggerValue - 触发器参数的当前值
   * @param allParams - 所有参数的当前值
   * @param updateParam - 更新参数值的函数
   */
  handler: (
    triggerValue: DynamicValue,
    allParams: DynamicValueMap,
    updateParam: (paramId: string, value: DynamicValue) => void
  ) => void
}

// ========== 联合类型 ==========

/**
 * 联动定义（所有类型的联合）
 *
 * 使用 discriminated union 确保类型安全
 */
export type Linkage =
  | ResetLinkage
  | FilterOptionsLinkage
  | FilterRangeLinkage
  | SetValueLinkage
  | AutoSwitchLinkage
  | DisableLinkage
  | HideLinkage
  | CustomLinkage

/**
 * 联动配置数组
 */
export type LinkageArray = Linkage[]
