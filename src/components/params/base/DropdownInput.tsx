/**
 * DropdownInput 组件
 *
 * 支持下拉选择
 * 支持 i18n 显示名称和选项
 * 支持禁用和条件显示
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import type { DropdownParamDef } from '@/core/types'

interface DropdownInputProps {
  param: DropdownParamDef
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

export const DropdownInput: React.FC<DropdownInputProps> = ({
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

  // 处理选择变化
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(e.target.value)
  }

  return (
    <div className="dropdown-input-wrapper">
      <label className="param-label">
        {displayName}
        {param.required && <span className="required-mark">*</span>}
      </label>
      <select
        value={value || ''}
        onChange={handleChange}
        disabled={disabled}
        className="dropdown-input"
      >
        {!param.required && <option value="">-- Select --</option>}
        {param.options.map((option) => {
          const optionLabel = typeof option.label === 'string'
            ? option.label
            : t(option.label.key, option.label.fallback)

          return (
            <option key={option.value} value={option.value}>
              {optionLabel}
            </option>
          )
        })}
      </select>
      {param.description && (
        <div className="param-description">{param.description}</div>
      )}
    </div>
  )
}
