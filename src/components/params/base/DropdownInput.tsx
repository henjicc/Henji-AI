/**
 * DropdownInput 组件
 *
 * 支持下拉选择
 * 支持 i18n 显示名称和选项
 * 支持禁用和条件显示
 */

import React, { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { DropdownParamDef } from '@/core/types'
import { getI18nText } from '@/core/types/I18nText'
import Dropdown from '@/components/ui/Dropdown'

interface DropdownInputProps {
  param: DropdownParamDef
  value: unknown
  onChange: (value: string | number) => void
  disabled?: boolean
}

function isUnsetValue(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

function isSameValue(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true
  }
  if (typeof left === 'string' && typeof right === 'string') {
    return left.trim().toLowerCase() === right.trim().toLowerCase()
  }
  if (left === undefined || left === null || right === undefined || right === null) {
    return false
  }
  return String(left) === String(right)
}

function isDurationLikeParam(param: DropdownParamDef, language: string): boolean {
  const searchText = [
    param.id,
    param.apiField,
    getI18nText(param.name, language),
    getI18nText(param.name, 'zh'),
    getI18nText(param.name, 'en'),
  ]
    .filter(Boolean)
    .join(' ')
  return /(duration|video[_\s-]?length|时长|秒)/i.test(searchText)
}

export const DropdownInput: React.FC<DropdownInputProps> = ({
  param,
  value,
  onChange,
  disabled = false
}) => {
  const { i18n } = useTranslation()
  const durationLike = isDurationLikeParam(param, i18n.language)
  const autoFixedRef = useRef<string | null>(null)

  // 获取显示名称（支持 i18n）
  const displayName = getI18nText(param.name, i18n.language)

  // 转换选项格式
  const options = param.options.map((option) => ({
    label: getI18nText(option.label, i18n.language),
    value: option.value,
    disabled: option.disabled === true
  }))

  const fallbackOption = useMemo(
    () => options.find((option) => option.disabled !== true),
    [options]
  )

  const effectiveValue = !isUnsetValue(value)
    ? value
    : (!isUnsetValue(param.default) ? param.default : fallbackOption?.value)

  // 获取当前选中项的显示文本
  const selectedOption = useMemo(
    () => options.find((opt) => isSameValue(opt.value, effectiveValue)),
    [options, effectiveValue]
  )
  const resolvedOption = selectedOption || fallbackOption
  const displayValue = resolvedOption?.label

  useEffect(() => {
    if (!resolvedOption) {
      return
    }
    if (selectedOption) {
      autoFixedRef.current = null
      return
    }
    const guardKey = `${param.id}:${String(resolvedOption.value)}`
    if (autoFixedRef.current === guardKey) {
      return
    }
    autoFixedRef.current = guardKey
    onChange(resolvedOption.value)
  }, [onChange, param.id, resolvedOption, selectedOption])

  return (
    <div className="w-auto">
      <label className="block text-sm font-medium text-zinc-300 mb-1.5">
        {displayName}
        {param.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <Dropdown
        value={resolvedOption ? resolvedOption.value : ''}
        display={displayValue}
        options={options}
        onSelect={onChange}
        disabled={disabled}
        buttonClassName="w-full"
        minWidthStrategy={durationLike ? 'display' : 'options'}
      />
    </div>
  )
}
