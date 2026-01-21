/**
 * ParamRenderer - 参数自动渲染器
 *
 * 根据参数定义自动选择和渲染对应的 UI 组件
 */

import React, { useMemo, useCallback } from 'react'
import type { ParamDef } from '@/core/types/ParamDef'
import { getI18nText } from '@/utils/i18n'
import { useTranslation } from 'react-i18next'

// 导入基础组件（这些组件需要在 Phase 2.1 中实现）
// 暂时使用占位符，实际实现时需要替换
const TextInput = ({ value, onChange, label, placeholder, multiline, maxLength, disabled }: any) => (
  <div className="param-input">
    <label>{label}</label>
    {multiline ? (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
      />
    ) : (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
      />
    )}
  </div>
)

const NumberInput = ({ value, onChange, label, min, max, step, placeholder, disabled }: any) => (
  <div className="param-input">
    <label>{label}</label>
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      disabled={disabled}
    />
  </div>
)

const SliderInput = ({ value, onChange, label, min, max, step, unit, marks, showInput, disabled }: any) => (
  <div className="param-input">
    <label>{label}</label>
    <input
      type="range"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
    />
    {showInput !== false && (
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
      />
    )}
    {unit && <span>{unit}</span>}
  </div>
)

const DropdownInput = ({ value, onChange, label, options, searchable, placeholder, disabled }: any) => (
  <div className="param-input">
    <label>{label}</label>
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      {placeholder && <option value="">{placeholder}</option>}
      {options?.map((opt: any) => (
        <option key={opt.value} value={opt.value} disabled={opt.disabled}>
          {typeof opt.label === 'string' ? opt.label : opt.label?.zh || opt.label?.en}
        </option>
      ))}
    </select>
  </div>
)

const SwitchInput = ({ value, onChange, label, onLabel, offLabel, disabled }: any) => (
  <div className="param-input">
    <label>{label}</label>
    <input
      type="checkbox"
      checked={value}
      onChange={(e) => onChange(e.target.checked)}
      disabled={disabled}
    />
    {value ? onLabel : offLabel}
  </div>
)

const RadioInput = ({ value, onChange, label, options, direction, disabled }: any) => (
  <div className="param-input">
    <label>{label}</label>
    <div style={{ display: 'flex', flexDirection: direction === 'horizontal' ? 'row' : 'column' }}>
      {options?.map((opt: any) => (
        <label key={opt.value}>
          <input
            type="radio"
            value={opt.value}
            checked={value === opt.value}
            onChange={(e) => onChange(opt.value)}
            disabled={disabled || opt.disabled}
          />
          {typeof opt.label === 'string' ? opt.label : opt.label?.zh || opt.label?.en}
        </label>
      ))}
    </div>
  </div>
)

// 组件映射表
const COMPONENT_MAP = {
  text: TextInput,
  number: NumberInput,
  slider: SliderInput,
  dropdown: DropdownInput,
  switch: SwitchInput,
  radio: RadioInput,
  // 特殊组件将在后续添加
  'image-upload': null,
  'video-upload': null,
  resolution: null,
  'aspect-ratio': null,
  panel: null,
} as const

interface ParamRendererProps {
  paramDef: ParamDef
  value: any
  onChange: (value: any) => void
  allParams: Record<string, any>
  getFilteredOptions?: (paramId: string) => any[]
  disabled?: boolean
}

/**
 * ParamRenderer 组件
 *
 * 根据参数定义自动渲染对应的 UI 组件
 */
export const ParamRenderer: React.FC<ParamRendererProps> = React.memo(({
  paramDef,
  value,
  onChange,
  allParams,
  getFilteredOptions,
  disabled: externalDisabled = false
}) => {
  const { i18n } = useTranslation()

  // 检查是否应该显示
  const isVisible = useMemo(() => {
    if (!paramDef.visible) return true

    if (typeof paramDef.visible.condition === 'function') {
      return paramDef.visible.condition(allParams)
    }

    if (typeof paramDef.visible.condition === 'string') {
      try {
        // 简单的表达式求值
        const fn = new Function('params', `
          with (params) {
            return ${paramDef.visible.condition}
          }
        `)
        return fn(allParams)
      } catch (error) {
        console.error('Visible condition evaluation error:', error)
        return true
      }
    }

    return true
  }, [paramDef.visible, allParams])

  // 检查是否应该禁用
  const isDisabled = useMemo(() => {
    if (externalDisabled) return true
    if (!paramDef.disabled) return false

    if (typeof paramDef.disabled.condition === 'function') {
      return paramDef.disabled.condition(allParams)
    }

    return false
  }, [paramDef.disabled, allParams, externalDisabled])

  // 如果不可见，返回 null
  if (!isVisible) {
    return null
  }

  // 获取组件
  const Component = COMPONENT_MAP[paramDef.component as keyof typeof COMPONENT_MAP]

  if (!Component) {
    return (
      <div className="param-renderer-error" data-param-id={paramDef.id}>
        <span>Unknown component type: {paramDef.component}</span>
      </div>
    )
  }

  // 获取显示文本
  const label = getI18nText(paramDef.name, i18n.language)
  const tooltip = paramDef.tooltip ? getI18nText(paramDef.tooltip, i18n.language) : undefined

  // 通用属性
  const commonProps = {
    value,
    onChange,
    disabled: isDisabled,
    label,
    tooltip
  }

  // 组件特定属性
  let specificProps = {}

  switch (paramDef.component) {
    case 'text':
      if ('placeholder' in paramDef) {
        specificProps = {
          placeholder: paramDef.placeholder ? getI18nText(paramDef.placeholder, i18n.language) : undefined,
          multiline: paramDef.multiline,
          maxLength: paramDef.maxLength
        }
      }
      break

    case 'number':
      if ('min' in paramDef) {
        specificProps = {
          min: paramDef.min,
          max: paramDef.max,
          step: paramDef.step,
          placeholder: paramDef.placeholder ? getI18nText(paramDef.placeholder, i18n.language) : undefined
        }
      }
      break

    case 'slider':
      if ('min' in paramDef) {
        specificProps = {
          min: paramDef.min,
          max: paramDef.max,
          step: paramDef.step,
          unit: paramDef.unit,
          marks: paramDef.marks,
          showInput: paramDef.showInput
        }
      }
      break

    case 'dropdown':
      if ('options' in paramDef) {
        specificProps = {
          options: getFilteredOptions ? getFilteredOptions(paramDef.id) : paramDef.options,
          searchable: paramDef.searchable,
          placeholder: paramDef.placeholder ? getI18nText(paramDef.placeholder, i18n.language) : undefined
        }
      }
      break

    case 'switch':
      if ('onLabel' in paramDef) {
        specificProps = {
          onLabel: paramDef.onLabel ? getI18nText(paramDef.onLabel, i18n.language) : undefined,
          offLabel: paramDef.offLabel ? getI18nText(paramDef.offLabel, i18n.language) : undefined
        }
      }
      break

    case 'radio':
      if ('options' in paramDef) {
        specificProps = {
          options: paramDef.options,
          direction: paramDef.direction
        }
      }
      break
  }

  return (
    <div className="param-renderer" data-param-id={paramDef.id}>
      <Component {...commonProps} {...specificProps} />
      {isDisabled && paramDef.disabled?.message && (
        <div className="param-disabled-message">
          {getI18nText(paramDef.disabled.message, i18n.language)}
        </div>
      )}
    </div>
  )
})

ParamRenderer.displayName = 'ParamRenderer'
