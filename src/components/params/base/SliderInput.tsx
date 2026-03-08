/**
 * SliderInput 组件
 *
 * 支持滑块输入，带有标记和拖动反馈
 * 支持 i18n 显示名称
 * 支持禁用和条件显示
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import type { SliderParamDef } from '@/core/types'
import { getI18nText } from '@/core/types/I18nText'
import { UiRangeInput } from '@/components/ui'

interface SliderInputProps {
  param: SliderParamDef
  value: number
  onChange: (value: number) => void
  disabled?: boolean
}

export const SliderInput: React.FC<SliderInputProps> = ({
  param,
  value,
  onChange,
  disabled = false
}) => {
  const { i18n } = useTranslation()

  // 获取显示名称（支持 i18n）
  const displayName = getI18nText(param.name, i18n.language)

  // 处理滑块变化
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseFloat(e.target.value)
    onChange(newValue)
  }

  // 计算标记位置
  const marks = param.marks || []
  const min = param.min ?? 0
  const max = param.max ?? 100
  const step = param.step ?? 1

  return (
    <div className="w-auto min-w-[200px]">
      <div className="flex justify-between items-center mb-1.5">
        <label className="text-sm font-medium text-zinc-300">
          {displayName}
          {param.required && <span className="text-red-500 ml-1">*</span>}
        </label>
        <span className="text-sm font-semibold text-[#007eff]">{value}</span>
      </div>
      <div className="relative py-2">
        <UiRangeInput
          value={value ?? min}
          onChange={handleChange}
          disabled={disabled}
          min={min}
          max={max}
          step={step}
          className="h-1.5 cursor-grab active:cursor-grabbing [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#007eff] [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110 [&::-webkit-slider-thumb]:hover:shadow-[0_0_0_4px_rgba(0,126,255,0.2)] [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[#007eff] [&::-moz-range-thumb]:transition-transform [&::-moz-range-thumb]:hover:scale-110 disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>
      {marks.length > 0 && (
        <div className="relative h-5 mt-2">
          {marks.map((mark, index) => {
            const position = ((mark.value - min) / (max - min)) * 100
            return (
              <div
                key={index}
                className="absolute transform -translate-x-1/2 text-center"
                style={{ left: `${position}%` }}
              >
                <div className="w-2 h-2 rounded-full bg-zinc-700/50 mx-auto mb-1" />
                <span className="text-xs text-zinc-500 whitespace-nowrap">{mark.label}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
