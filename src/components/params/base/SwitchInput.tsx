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
import { getI18nText } from '@/core/types/I18nText'

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
  const { i18n } = useTranslation()

  // 获取显示名称（支持 i18n）
  const displayName = getI18nText(param.name, i18n.language)

  // 处理开关变化
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.checked)
  }

  return (
    <div className="w-auto">
      <label className="flex justify-between items-center cursor-pointer">
        <span className="text-sm font-medium text-zinc-300">
          {displayName}
          {param.required && <span className="text-red-500 ml-1">*</span>}
        </span>
        <div className="relative w-11 h-6 ml-3">
          <input
            type="checkbox"
            checked={value || false}
            onChange={handleChange}
            disabled={disabled}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-zinc-700/50 rounded-full peer-checked:bg-[#007eff] transition-colors peer-disabled:opacity-50" />
          <div className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
        </div>
      </label>
    </div>
  )
}
