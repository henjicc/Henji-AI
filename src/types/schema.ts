export type ParamType = 'dropdown' | 'toggle' | 'number' | 'text'

/**
 * 分辨率参数配置
 * 用于声明参数的类型和智能匹配行为
 */
export interface ResolutionConfig {
    type: 'aspect_ratio' | 'size' | 'resolution'  // 参数类型
    smartMatch: boolean                            // 是否启用智能匹配
    visualize: boolean                             // 是否使用可视化选择器
    extractRatio?: (value: any) => number | null   // 从参数值提取宽高比的函数
    customInput?: boolean                          // 是否支持自定义输入
    qualityOptions?: Array<{ value: any; label: string }>  // 质量选项（如 2K/4K）
    qualityKey?: string                            // 质量参数的 key（默认为 'resolutionQuality'）

    // 基数配置（新增）
    baseSize?: number                              // 基数（正方形时的边长，默认 1440）
    baseSizeEditable?: boolean                     // 是否允许用户编辑基数（默认 false）
    baseSizeMin?: number                           // 基数最小值（默认 512）
    baseSizeMax?: number                           // 基数最大值（默认 2048）
    baseSizeStep?: number                          // 基数步进值（默认 8，必须是8的倍数）
    baseSizeKey?: string                           // 基数参数的 key（默认为 'resolutionBaseSize'）
}

export interface BaseParam {
    id: string
    label?: string
    type: ParamType
    defaultValue?: any  // 参数的默认值（当切换到该模型时自动设置）
    autoSwitch?: {      // 自动切换规则（当条件满足时自动切换参数值）
        condition: (values: any) => boolean  // 触发条件
        value: any  // 切换到的值
    }
    resolutionConfig?: ResolutionConfig  // 分辨率参数配置
    hidden?: (values: any) => boolean
    disabled?: (values: any) => boolean
    className?: string
    tooltip?: string
    tooltipDelay?: number
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
