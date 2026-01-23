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
import { getI18nText } from '@/core/types/I18nText'
import Dropdown from '@/components/ui/Dropdown'

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
  const { i18n } = useTranslation()

  // 获取显示名称（支持 i18n）
  const displayName = getI18nText(param.name, i18n.language)

  // 转换选项格式
  const options = param.options.map((option) => ({
    label: getI18nText(option.label, i18n.language),
    value: option.value
  }))

  // 获取当前选中项的显示文本
  const selectedOption = options.find(opt => opt.value === value)
  const displayValue = selectedOption?.label || ''

  return (
    <div className="w-auto">
      <label className="block text-sm font-medium text-zinc-300 mb-1.5">
        {displayName}
        {param.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <Dropdown
        value={value || ''}
        display={displayValue}
        options={options}
        onSelect={onChange}
        disabled={disabled}
        buttonClassName="w-full"
      />
    </div>
  )
}
