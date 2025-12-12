export type ParamType = 'dropdown' | 'toggle' | 'number' | 'text'

/**
 * 分辨率参数配置
 * 用于声明参数的类型和智能匹配行为
 */
export interface ResolutionConfig {
    type: 'aspect_ratio' | 'size' | 'resolution'  // 参数类型
    smartMatch?: boolean                           // 是否启用智能匹配
    visualize?: boolean                            // 是否使用可视化选择器
    extractRatio?: (value: any) => number | null   // 从参数值提取宽高比的函数
    customInput?: boolean                          // 是否支持自定义输入
    qualityOptions?: Array<{ value: any; label: string }> | ((values: any) => Array<{ value: any; label: string }>)  // 质量选项（如 2K/4K）
    qualityKey?: string                            // 质量参数的 key（默认为 'resolutionQuality'）
    defaultQuality?: string                        // 默认质量选项
    hideAspectRatio?: (values: any) => boolean     // 是否隐藏宽高比选择器（仅保留质量选择器）

    // 基数配置
    baseSize?: number                              // 基数（正方形时的边长，默认 1440）
    baseSizeEditable?: boolean                     // 是否允许用户编辑基数（默认 false）
    baseSizeMin?: number                           // 基数最小值（默认 512）
    baseSizeMax?: number                           // 基数最大值（默认 2048）
    baseSizeStep?: number                          // 基数步进值（默认 8，必须是8的倍数）
    baseSizeKey?: string                           // 基数参数的 key（默认为 'resolutionBaseSize'）
    minSize?: number                               // 最小边长
    maxSize?: number                               // 最大边长

    // 专用计算器标记（互斥，只能启用一个）
    useSeedreamCalculator?: boolean                // 使用即梦专用计算器（fal.ai 或派欧云即梦模型）
    seedreamProvider?: 'fal' | 'ppio'              // 即梦模型提供商：fal.ai 或派欧云（默认 fal）
    useQwenCalculator?: boolean                    // 使用 Qwen 专用计算器（魔搭 Qwen 模型）
}

export interface BaseParam {
    id: string
    label?: string
    type: ParamType
    defaultValue?: any  // 参数的默认值（当切换到该模型时自动设置）
    autoSwitch?: {      // 自动切换规则（当条件满足时自动切换参数值）
        condition: (values: any) => boolean  // 触发条件
        value: any | ((values: any) => any)  // 切换到的值（可以是静态值或函数）
        noRestore?: boolean  // 是否在条件不满足时恢复默认值
        watchKeys?: string[]  // 监听的 key 列表，只有这些 key 变化时才触发检查（默认监听所有 values）
    }
    resolutionConfig?: ResolutionConfig  // 分辨率参数配置
    hidden?: (values: any) => boolean
    disabled?: (values: any) => boolean
    className?: string
    tooltip?: string
    tooltipDelay?: number
    description?: string  // 参数描述
}

export interface DropdownOption {
    label: string
    value: string | number | boolean
    disabled?: boolean
}

export interface DropdownParam extends BaseParam {
    type: 'dropdown'
    options: DropdownOption[] | ((values: any) => DropdownOption[])
    display?: (value: any) => string
    panelClassName?: string
    buttonClassName?: string
    placeholder?: string
}

export interface ToggleParam extends BaseParam {
    type: 'toggle'
    toValue?: (checked: boolean) => any  // Convert from boolean to actual value
    fromValue?: (value: any) => boolean  // Convert from actual value to boolean
}

export interface NumberParam extends BaseParam {
    type: 'number'
    min?: number
    max?: number
    step?: number
    precision?: number
    widthClassName?: string
}

export interface TextParam extends BaseParam {
    type: 'text'
    placeholder?: string
    inputClassName?: string
}

export type ParamDef = DropdownParam | ToggleParam | NumberParam | TextParam
