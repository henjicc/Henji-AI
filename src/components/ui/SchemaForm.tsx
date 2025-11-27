import React from 'react'
import { ParamDef } from '../../types/schema'
import ParamRow from './ParamRow'
import Dropdown from './Dropdown'
import Toggle from './Toggle'
import NumberInput from './NumberInput'
import TextInput from './TextInput'
import Tooltip from './Tooltip'
import UniversalResolutionSelector from './UniversalResolutionSelector'

interface SchemaFormProps {
    schema: ParamDef[]
    values: Record<string, any>
    onChange: (id: string, value: any) => void
    className?: string
}

export default function SchemaForm({ schema, values, onChange, className }: SchemaFormProps) {
    // Filter out hidden parameters
    const visibleParams = schema.filter(param => {
        if (param.hidden) {
            return !param.hidden(values)
        }
        return true
    })

    if (visibleParams.length === 0) return null

    // Helper function to wrap component with Tooltip if needed
    const wrapWithTooltip = (component: React.ReactElement, param: ParamDef, key: string) => {
        if (param.tooltip) {
            return (
                <Tooltip key={key} content={param.tooltip} delay={param.tooltipDelay || 500}>
                    {component}
                </Tooltip>
            )
        }
        // Clone element with key if no tooltip
        return React.cloneElement(component, { key })
    }

    return (
        <ParamRow className={className}>
            {visibleParams.map(param => {
                const commonProps = {
                    label: param.label,
                    disabled: param.disabled ? param.disabled(values) : false,
                }

                switch (param.type) {
                    case 'dropdown': {
                        const p = param as import('../../types/schema').DropdownParam
                        const options = typeof p.options === 'function' ? p.options(values) : p.options

                        // 如果有 resolutionConfig，使用 UniversalResolutionSelector
                        if (p.resolutionConfig) {
                            // 确定质量参数的 key（不同模型可能不同）
                            // 即梦4.0 使用 resolutionQuality，Nano Banana Pro 使用 resolution
                            const qualityKey = p.resolutionConfig.qualityKey || 'resolutionQuality'

                            const component = (
                                <UniversalResolutionSelector
                                    label={param.label}
                                    value={values[param.id]}
                                    options={options}
                                    config={p.resolutionConfig}
                                    customWidth={values.customWidth}
                                    customHeight={values.customHeight}
                                    qualityValue={values[qualityKey]}
                                    onChange={(v) => onChange(param.id, v)}
                                    onWidthChange={p.resolutionConfig.customInput ? (v) => onChange('customWidth', v) : undefined}
                                    onHeightChange={p.resolutionConfig.customInput ? (v) => onChange('customHeight', v) : undefined}
                                    onQualityChange={p.resolutionConfig.qualityOptions ? (v) => onChange(qualityKey, v) : undefined}
                                />
                            )
                            return wrapWithTooltip(component, param, param.id)
                        }

                        // 普通 dropdown
                        // Calculate display label if not provided
                        let displayLabel = p.display ? p.display(values[param.id]) : undefined
                        if (!displayLabel && values[param.id] !== undefined) {
                            const selectedOption = options.find(opt => opt.value === values[param.id])
                            if (selectedOption) {
                                displayLabel = selectedOption.label
                            }
                        }

                        const component = (
                            <Dropdown
                                {...commonProps}
                                value={values[param.id]}
                                display={displayLabel}
                                options={options}
                                onSelect={(v) => onChange(param.id, v)}
                                className={`w-auto ${param.className || ''}`}
                                panelClassName={p.panelClassName}
                                buttonClassName={p.buttonClassName}
                            />
                        )
                        return wrapWithTooltip(component, param, param.id)
                    }
                    case 'toggle': {
                        const p = param as import('../../types/schema').ToggleParam
                        const component = (
                            <Toggle
                                {...commonProps}
                                checked={p.fromValue ? p.fromValue(values[param.id]) : values[param.id]}
                                onChange={(v) => onChange(param.id, p.toValue ? p.toValue(v) : v)}
                                className={`w-auto ${param.className || ''}`}
                            />
                        )
                        return wrapWithTooltip(component, param, param.id)
                    }
                    case 'number': {
                        const p = param as import('../../types/schema').NumberParam
                        const component = (
                            <NumberInput
                                {...commonProps}
                                value={values[param.id]}
                                onChange={(v) => onChange(param.id, v)}
                                min={p.min}
                                max={p.max}
                                step={p.step}
                                precision={p.precision}
                                className={`w-auto ${param.className || ''}`}
                                widthClassName={p.widthClassName}
                            />
                        )
                        return wrapWithTooltip(component, param, param.id)
                    }
                    case 'text': {
                        const p = param as import('../../types/schema').TextParam
                        const component = (
                            <TextInput
                                {...commonProps}
                                value={values[param.id]}
                                onChange={(v) => onChange(param.id, v)}
                                placeholder={p.placeholder}
                                className={param.className || 'w-auto'}
                                inputClassName={p.inputClassName}
                            />
                        )
                        return wrapWithTooltip(component, param, param.id)
                    }
                    default:
                        return null
                }
            })}
        </ParamRow>
    )
}
