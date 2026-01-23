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
import { getI18nText } from '@/core/types/I18nText'

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
  const { i18n } = useTranslation()

  // 获取显示名称（支持 i18n）
  const displayName = getI18nText(param.name, i18n.language)
  const placeholder = getI18nText(param.placeholder || '', i18n.language)

  // 处理输入变化
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    onChange(e.target.value)
  }

  // 多行文本输入
  if (param.multiline) {
    return (
      <div className="w-auto">
        <label className="block text-sm font-medium text-zinc-300 mb-1.5">
          {displayName}
          {param.required && <span className="text-red-500 ml-1">*</span>}
        </label>
        <textarea
          value={value || ''}
          onChange={handleChange}
          disabled={disabled}
          placeholder={placeholder}
          rows={param.rows || 4}
          className="w-full min-h-[80px] px-3 py-2 bg-zinc-800/70 border border-zinc-700/50 rounded text-zinc-100 placeholder-zinc-500 resize-y transition-colors hover:border-[#007eff]/50 focus:border-[#007eff] focus:ring-1 focus:ring-[#007eff]/20 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>
    )
  }

  // 单行文本输入
  return (
    <div className="w-auto">
      <label className="block text-sm font-medium text-zinc-300 mb-1.5">
        {displayName}
        {param.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <input
        type="text"
        value={value || ''}
        onChange={handleChange}
        disabled={disabled}
        placeholder={placeholder}
        className="w-full h-[38px] px-3 bg-zinc-800/70 border border-zinc-700/50 rounded text-zinc-100 placeholder-zinc-500 transition-colors hover:border-[#007eff]/50 focus:border-[#007eff] focus:ring-1 focus:ring-[#007eff]/20 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
      />
    </div>
  )
}
