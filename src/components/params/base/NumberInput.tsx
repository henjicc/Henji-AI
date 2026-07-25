/**
 * NumberInput 组件
 *
 * 支持数字输入，保留范围、步长与快捷刻度能力
 */

import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { NumberParamDef } from '@/core/types'
import { getI18nText } from '@/core/types/I18nText'
import { UiIconButton, UiInput, UiOptionButton } from '@/components/ui'

interface NumberInputProps {
  param: NumberParamDef
  value: number
  onChange: (value: number) => void
  disabled?: boolean
}

function resolvePrecision(step: number | undefined): number {
  if (typeof step !== 'number' || !Number.isFinite(step)) {
    return 0
  }

  const normalized = String(step).toLowerCase()

  if (normalized.includes('e-')) {
    const [, exponent = '0'] = normalized.split('e-')
    return Number.parseInt(exponent, 10) || 0
  }

  const fraction = normalized.split('.')[1]
  return fraction ? fraction.length : 0
}

function roundValue(value: number, step: number | undefined): number {
  const precision = resolvePrecision(step)

  if (precision <= 0) {
    return value
  }

  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

function clampValue(value: number, param: NumberParamDef): number {
  let nextValue = value

  if (typeof param.min === 'number') {
    nextValue = Math.max(param.min, nextValue)
  }

  if (typeof param.max === 'number') {
    nextValue = Math.min(param.max, nextValue)
  }

  return roundValue(nextValue, param.step)
}

function isTransientInput(raw: string): boolean {
  return raw === '' || raw === '-' || raw === '.' || raw === '-.'
}

export const NumberInput: React.FC<NumberInputProps> = ({
  param,
  value,
  onChange,
  disabled = false
}) => {
  const { i18n } = useTranslation()
  const displayName = getI18nText(param.name, i18n.language)
  const placeholderText = param.placeholder
    ? getI18nText(param.placeholder, i18n.language)
    : undefined
  const safeValue = typeof value === 'number' && Number.isFinite(value)
    ? clampValue(value, param)
    : clampValue(typeof param.default === 'number' ? param.default : param.min ?? 0, param)
  const step = param.step || 1
  const hasMarks = Boolean(param.marks && param.marks.length > 0)
  const [inputValue, setInputValue] = useState(() => String(safeValue))
  const [isFocused, setIsFocused] = useState(false)

  useEffect(() => {
    if (!isFocused) {
      setInputValue(String(safeValue))
    }
  }, [isFocused, safeValue])

  const commitValue = (raw: string) => {
    const parsedValue = Number.parseFloat(raw)

    if (!Number.isFinite(parsedValue)) {
      setInputValue(String(safeValue))
      onChange(safeValue)
      return
    }

    const nextValue = clampValue(parsedValue, param)
    setInputValue(String(nextValue))
    onChange(nextValue)
  }

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = event.target.value
    setInputValue(rawValue)

    if (isTransientInput(rawValue)) {
      return
    }

    const parsedValue = Number.parseFloat(rawValue)
    if (!Number.isFinite(parsedValue)) {
      return
    }

    onChange(clampValue(parsedValue, param))
  }

  const handleStepChange = (direction: 1 | -1) => {
    const nextValue = clampValue(safeValue + step * direction, param)
    setInputValue(String(nextValue))
    onChange(nextValue)
  }

  const handleBlur = () => {
    setIsFocused(false)

    if (isTransientInput(inputValue)) {
      setInputValue(String(safeValue))
      return
    }

    commitValue(inputValue)
  }

  const isMarkActive = (markValue: number): boolean => {
    const tolerance = Math.max(step / 10, Number.EPSILON)
    return Math.abs(safeValue - markValue) <= tolerance
  }

  return (
    <div className={hasMarks ? 'w-auto min-w-[200px]' : 'w-fit'}>
      <label className="mb-1.5 block text-sm font-medium text-zinc-300">
        {displayName}
        {param.required && <span className="text-red-500 ml-1">*</span>}
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative inline-block">
          <UiInput
            type="number"
            value={inputValue}
            onChange={handleChange}
            onFocus={() => setIsFocused(true)}
            onBlur={handleBlur}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur()
              }
            }}
            disabled={disabled}
            min={param.min}
            max={param.max}
            step={step}
            placeholder={placeholderText}
            className="h-[38px] w-28 pr-8"
          />
          <div className="absolute inset-y-0 right-1 flex flex-col justify-center gap-1">
            <UiIconButton
              type="button"
              showBorder={false}
              onClick={() => handleStepChange(1)}
              disabled={disabled || (param.max !== undefined && safeValue >= param.max)}
              className="!h-4 !w-6 rounded-none border-0 bg-transparent p-0 text-3xs leading-none text-zinc-300 hover:text-zinc-200"
            >
              ▲
            </UiIconButton>
            <UiIconButton
              type="button"
              showBorder={false}
              onClick={() => handleStepChange(-1)}
              disabled={disabled || (param.min !== undefined && safeValue <= param.min)}
              className="!h-4 !w-6 rounded-none border-0 bg-transparent p-0 text-3xs leading-none text-zinc-300 hover:text-zinc-200"
            >
              ▼
            </UiIconButton>
          </div>
        </div>

        {param.unit && <span className="text-sm text-text-muted">{param.unit}</span>}
      </div>

      {hasMarks && (
        <div className="mt-2 flex flex-wrap gap-2">
          {param.marks!.map((mark) => (
            <UiOptionButton
              key={`${param.id}-${mark.value}`}
              type="button"
              variant="flat"
              active={isMarkActive(mark.value)}
              disabled={disabled}
              onClick={() => {
                const nextValue = clampValue(mark.value, param)
                setInputValue(String(nextValue))
                onChange(nextValue)
              }}
              className="!h-8 !px-2.5 !py-1 !text-xs"
            >
              {mark.label}
            </UiOptionButton>
          ))}
        </div>
      )}
    </div>
  )
}
