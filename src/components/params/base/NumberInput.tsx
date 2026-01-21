/**
 * NumberInput 组件
 *
 * 支持数字输入，带有 min/max/step 验证
 * 支持 i18n 显示名称
 * 支持禁用和条件显示
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import type { NumberParamDef } from '@/core/types'

interface NumberInputProps {
  param: NumberParamDef
  value: number
  onChange: (value: number) => void
  disabled?: boolean
}

export const NumberInput: React.FC<NumberInputProps> = ({
  param,
  value,
  onChange,
  disabled = false
}) => {
  const { t } = useTranslation()

  // 获取显示名称（支持 i18n）
  const displayName = param.displayName
    ? (typeof param.displayName === 'string'
        ? param.displayName
        : t(param.displayName.key, param.displayName.fallback))
    : param.id

  // 处理输入变化
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseFloat(e.target.value)

    // 验证范围
    if (!isNaN(newValue)) {
      let validValue = newValue

      if (param.min !== undefined && validValue < param.min) {
        validValue = param.min
      }
      if (param.max !== undefined && validValue > param.max) {
        validValue = param.max
      }

      onChange(validValue)
    }
  }

  // 处理增减按钮
  const handleIncrement = () => {
    const step = param.step || 1
    const newValue = (value || 0) + step

    if (param.max === undefined || newValue <= param.max) {
      onChange(newValue)
    }
  }

  const handleDecrement = () => {
    const step = param.step || 1
    const newValue = (value || 0) - step

    if (param.min === undefined || newValue >= param.min) {
      onChange(newValue)
    }
  }

  return (
    <div className="number-input-wrapper">
      <label className="param-label">
        {displayName}
        {param.required && <span className="required-mark">*</span>}
      </label>
      <div className="number-input-control">
        <button
          type="button"
          className="number-input-btn"
          onClick={handleDecrement}
          disabled={disabled || (param.min !== undefined && value <= param.min)}
        >
          -
        </button>
        <input
          type="number"
          value={value ?? ''}
          onChange={handleChange}
          disabled={disabled}
          min={param.min}
          max={param.max}
          step={param.step || 1}
          className="number-input"
        />
        <button
          type="button"
          className="number-input-btn"
          onClick={handleIncrement}
          disabled={disabled || (param.max !== undefined && value >= param.max)}
        >
          +
        </button>
      </div>
      {param.description && (
        <div className="param-description">{param.description}</div>
      )}
    </div>
  )
}
