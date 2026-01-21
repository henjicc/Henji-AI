/**
 * RadioInput 组件
 *
 * 单选组组件，支持水平和垂直布局
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import type { RadioParamDef } from '@/core/types'

interface RadioInputProps {
  param: RadioParamDef
  value: string | number
  onChange: (value: string | number) => void
  disabled?: boolean
}

export const RadioInput: React.FC<RadioInputProps> = ({
  param,
  value,
  onChange,
  disabled = false
}) => {
  const { t } = useTranslation()

  // 获取显示名称
  const displayName = param.displayName
    ? (typeof param.displayName === 'string'
        ? param.displayName
        : t(param.displayName.key, param.displayName.fallback))
    : param.id

  // 获取选项标签
  const getOptionLabel = (opt: typeof param.options[0]) => {
    return typeof opt.label === 'string'
      ? opt.label
      : t(opt.label.key, opt.label.fallback)
  }

  // 获取选项描述
  const getOptionDescription = (opt: typeof param.options[0]) => {
    if (!opt.description) return null
    return typeof opt.description === 'string'
      ? opt.description
      : t(opt.description.key, opt.description.fallback)
  }

  const layout = param.layout || 'vertical'

  return (
    <div className="radio-input-wrapper">
      <label className="param-label">
        {displayName}
        {param.required && <span className="required-mark">*</span>}
      </label>

      <div className={`radio-group ${layout}`}>
        {param.options.map((option) => {
          const isSelected = option.value === value
          const isDisabled = disabled || option.disabled

          return (
            <label
              key={option.value}
              className={`radio-option ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
            >
              <input
                type="radio"
                name={param.id}
                value={option.value}
                checked={isSelected}
                onChange={() => !isDisabled && onChange(option.value)}
                disabled={isDisabled}
                className="radio-input"
              />
              <span className="radio-circle">
                {isSelected && <span className="radio-dot" />}
              </span>
              <div className="radio-content">
                <span className="radio-label">{getOptionLabel(option)}</span>
                {getOptionDescription(option) && (
                  <span className="radio-description">
                    {getOptionDescription(option)}
                  </span>
                )}
              </div>
            </label>
          )
        })}
      </div>

      {param.description && (
        <div className="param-description">{param.description}</div>
      )}
    </div>
  )
}
