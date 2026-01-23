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
import { getI18nText } from '@/core/types/I18nText'

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
  const { i18n } = useTranslation()

  // 获取显示名称（支持 i18n）
  const displayName = getI18nText(param.name, i18n.language)

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
    <div className="w-auto">
      <label className="block text-sm font-medium text-zinc-300 mb-1.5">
        {displayName}
        {param.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <div className="relative inline-block">
        <input
          type="number"
          value={value ?? ''}
          onChange={handleChange}
          disabled={disabled}
          min={param.min}
          max={param.max}
          step={param.step || 1}
          className="w-20 bg-zinc-800/70 backdrop-blur-lg border border-zinc-700/50 rounded-lg px-3 pr-8 py-2 h-[38px] text-sm outline-none focus:outline-none appearance-none focus:ring-inset focus:ring-2 focus:ring-[#007eff]/60 focus:ring-offset-0 focus:ring-offset-transparent focus:border-[#007eff] transition-shadow duration-300 ease-out disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <div className="absolute inset-y-0 right-1 flex flex-col justify-center gap-1">
          <button
            type="button"
            onClick={handleIncrement}
            disabled={disabled || (param.max !== undefined && value >= param.max)}
            className="w-6 h-4 bg-transparent text-zinc-300 text-[10px] leading-none hover:text-zinc-200 outline-none focus:outline-none ring-0 focus:ring-0 cursor-pointer flex items-center justify-center"
          >
            ▲
          </button>
          <button
            type="button"
            onClick={handleDecrement}
            disabled={disabled || (param.min !== undefined && value <= param.min)}
            className="w-6 h-4 bg-transparent text-zinc-300 text-[10px] leading-none hover:text-zinc-200 outline-none focus:outline-none ring-0 focus:ring-0 cursor-pointer flex items-center justify-center"
          >
            ▼
          </button>
        </div>
      </div>
    </div>
  )
}
