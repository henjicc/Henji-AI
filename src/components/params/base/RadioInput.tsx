/**
 * RadioInput 组件
 *
 * 单选组组件，支持水平和垂直布局
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import type { RadioParamDef } from '@/core/types'
import { getI18nText } from '@/core/types/I18nText'

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
  const { i18n } = useTranslation()

  // 获取显示名称
  const displayName = getI18nText(param.name, i18n.language)

  // 获取选项标签
  const getOptionLabel = (opt: typeof param.options[0]) => {
    return getI18nText(opt.label, i18n.language)
  }

  // 获取选项描述
  const getOptionDescription = (opt: typeof param.options[0]) => {
    if (!opt.description) return null
    return getI18nText(opt.description, i18n.language)
  }

  const layout = param.direction || 'vertical'

  return (
    <div className="w-auto">
      <label className="block text-sm font-medium text-zinc-300 mb-1.5">
        {displayName}
        {param.required && <span className="text-red-500 ml-1">*</span>}
      </label>

      <div className={`flex gap-3 ${layout === 'vertical' ? 'flex-col' : 'flex-row flex-wrap'}`}>
        {param.options.map((option) => {
          const isSelected = option.value === value
          const isDisabled = disabled || option.disabled

          return (
            <label
              key={String(option.value)}
              className={`flex items-start gap-2 p-3 border rounded cursor-pointer transition-colors ${
                isSelected
                  ? 'border-[#007eff] bg-[#007eff]/10'
                  : 'border-zinc-700/50 bg-zinc-800/70 hover:border-[#007eff]/50 hover:bg-zinc-800'
              } ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="relative w-[18px] h-[18px] min-w-[18px] mt-0.5">
                <input
                  type="radio"
                  name={param.id}
                  value={String(option.value)}
                  checked={isSelected}
                  onChange={() => !isDisabled && onChange(option.value)}
                  disabled={isDisabled}
                  className="sr-only"
                />
                <div
                  className={`w-[18px] h-[18px] rounded-full border-2 transition-colors ${
                    isSelected ? 'border-[#007eff]' : 'border-zinc-700/50'
                  }`}
                >
                  {isSelected && (
                    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[#007eff] animate-[radioDotAppear_0.2s_ease-out]" />
                  )}
                </div>
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-zinc-200">{getOptionLabel(option)}</div>
                {getOptionDescription(option) && (
                  <div className="text-xs text-zinc-500 mt-1">{getOptionDescription(option)}</div>
                )}
              </div>
            </label>
          )
        })}
      </div>
    </div>
  )
}
