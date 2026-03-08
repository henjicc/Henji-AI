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
import { UiIconButton, UiInput } from '@/components/ui'

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
        <UiInput
          type="number"
          value={value ?? ''}
          onChange={handleChange}
          disabled={disabled}
          min={param.min}
          max={param.max}
          step={param.step || 1}
          className="h-[38px] w-20 pr-8"
        />
        <div className="absolute inset-y-0 right-1 flex flex-col justify-center gap-1">
          <UiIconButton
            onClick={handleIncrement}
            disabled={disabled || (param.max !== undefined && value >= param.max)}
            className="!h-4 !w-6 rounded-none border-0 bg-transparent p-0 text-[10px] leading-none text-zinc-300 hover:text-zinc-200"
          >
            ▲
          </UiIconButton>
          <UiIconButton
            onClick={handleDecrement}
            disabled={disabled || (param.min !== undefined && value <= param.min)}
            className="!h-4 !w-6 rounded-none border-0 bg-transparent p-0 text-[10px] leading-none text-zinc-300 hover:text-zinc-200"
          >
            ▼
          </UiIconButton>
        </div>
      </div>
    </div>
  )
}
