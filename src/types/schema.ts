export type ParamType = 'dropdown' | 'toggle' | 'number' | 'text'

export interface BaseParam {
    id: string
    label?: string
    type: ParamType
    defaultValue?: any  // 参数的默认值（当切换到该模型时自动设置）
    autoSwitch?: {      // 自动切换规则（当条件满足时自动切换参数值）
        condition: (values: any) => boolean  // 触发条件
        value: any  // 切换到的值
    }
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
