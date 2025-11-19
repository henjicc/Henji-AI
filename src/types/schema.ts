export type ParamType = 'dropdown' | 'toggle' | 'number' | 'text'

export interface BaseParam {
    id: string
    label?: string
    type: ParamType
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
