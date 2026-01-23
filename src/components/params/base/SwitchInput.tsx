/**
 * SwitchInput 组件
 *
 * 支持开关切换（按钮式样式）
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
  const { i18n, t } = useTranslation()

  // 获取显示名称（支持 i18n）
  const displayName = getI18nText(param.name, i18n.language)

  // 获取开关文字
  const onText = t('common:on', '开启')
  const offText = t('common:off', '关闭')

  // 处理点击
  const handleClick = () => {
    if (!disabled) {
      onChange(!value)
    }
  }

  return (
    <div className="w-auto">
      {displayName && (
        <label className="block text-sm font-medium mb-1 text-zinc-300">
          {displayName}
          {param.required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className={`px-3 h-[38px] rounded-lg border transition-colors inline-flex items-center justify-center ${
          disabled
            ? 'bg-zinc-800/30 text-zinc-500 border-zinc-700/30 cursor-not-allowed opacity-50'
            : value
              ? 'bg-[#007eff] text-white border-[#007eff]'
              : 'bg-zinc-800/70 text-zinc-300 border-zinc-700/50'
        }`}
      >
        {value ? onText : offText}
      </button>
    </div>
  )
}
