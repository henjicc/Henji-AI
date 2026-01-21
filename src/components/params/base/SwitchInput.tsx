/**
 * SwitchInput 组件
 *
 * 支持开关切换
 * 支持 i18n 显示名称
 * 支持禁用和条件显示
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import type { SwitchParamDef } from '@/core/types'

interface SwitchInputProps {
  param: SwitchParamDef
  value: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}

export const SwitchInput: React.FC<SwitchInputProps> = ({
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

  // 处理开关变化
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.checked)
  }

  return (
    <div className="switch-input-wrapper">
      <label className="switch-label">
        <span className="param-label">
          {displayName}
          {param.required && <span className="required-mark">*</span>}
        </span>
        <div className="switch-control">
          <input
            type="checkbox"
            checked={value || false}
            onChange={handleChange}
            disabled={disabled}
            className="switch-input"
          />
          <span className="switch-slider"></span>
        </div>
      </label>
      {param.description && (
        <div className="param-description">{param.description}</div>
      )}
    </div>
  )
}
