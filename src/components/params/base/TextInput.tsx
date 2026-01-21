/**
 * TextInput 组件
 *
 * 支持单行和多行文本输入
 * 支持 i18n 显示名称
 * 支持禁用和条件显示
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import type { TextParamDef } from '@/core/types'

interface TextInputProps {
  param: TextParamDef
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

export const TextInput: React.FC<TextInputProps> = ({
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
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    onChange(e.target.value)
  }

  // 多行文本输入
  if (param.multiline) {
    return (
      <div className="text-input-wrapper">
        <label className="param-label">
          {displayName}
          {param.required && <span className="required-mark">*</span>}
        </label>
        <textarea
          value={value || ''}
          onChange={handleChange}
          disabled={disabled}
          placeholder={param.placeholder}
          rows={param.rows || 4}
          className="text-input text-input-multiline"
        />
        {param.description && (
          <div className="param-description">{param.description}</div>
        )}
      </div>
    )
  }

  // 单行文本输入
  return (
    <div className="text-input-wrapper">
      <label className="param-label">
        {displayName}
        {param.required && <span className="required-mark">*</span>}
      </label>
      <input
        type="text"
        value={value || ''}
        onChange={handleChange}
        disabled={disabled}
        placeholder={param.placeholder}
        className="text-input"
      />
      {param.description && (
        <div className="param-description">{param.description}</div>
      )}
    </div>
  )
}
