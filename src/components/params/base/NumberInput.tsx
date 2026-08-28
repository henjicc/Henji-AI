/**
 * Schema 数字参数：标签、单位与快捷刻度由这里编排，输入和竖排步进器复用通用 NumberInput。
 */

import React from 'react'
import { useTranslation } from 'react-i18next'

import NumberField from '@/components/ui/NumberInput'
import {
  UI_FIELD_LABEL_CLASS,
  UI_TEXT_META_CLASS,
  UiOptionButton,
} from '@/components/ui'
import type { NumberParamDef } from '@/core/types'
import { getI18nText } from '@/core/types/I18nText'

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

function clampValue(value: number, param: NumberParamDef): number {
  let nextValue = value

  if (typeof param.min === 'number') {
    nextValue = Math.max(param.min, nextValue)
  }
  if (typeof param.max === 'number') {
    nextValue = Math.min(param.max, nextValue)
  }

  const precision = resolvePrecision(param.step)
  if (precision <= 0) {
    return nextValue
  }

  const factor = 10 ** precision
  return Math.round(nextValue * factor) / factor
}

export const NumberInput: React.FC<NumberInputProps> = ({
  param,
  value,
  onChange,
  disabled = false,
}) => {
  const { i18n } = useTranslation()
  const displayName = getI18nText(param.name, i18n.language)
  const increaseLabel = i18n.language.startsWith('zh') ? `增加${displayName}` : `Increase ${displayName}`
  const decreaseLabel = i18n.language.startsWith('zh') ? `减少${displayName}` : `Decrease ${displayName}`
  const placeholderText = param.placeholder
    ? getI18nText(param.placeholder, i18n.language)
    : undefined
  const safeValue = typeof value === 'number' && Number.isFinite(value)
    ? clampValue(value, param)
    : clampValue(typeof param.default === 'number' ? param.default : param.min ?? 0, param)
  const step = param.step || 1
  const hasMarks = Boolean(param.marks && param.marks.length > 0)

  const isMarkActive = (markValue: number): boolean => {
    const tolerance = Math.max(step / 10, Number.EPSILON)
    return Math.abs(safeValue - markValue) <= tolerance
  }

  return (
    <div className={hasMarks ? 'w-auto min-w-[200px]' : 'w-fit'}>
      <label className={UI_FIELD_LABEL_CLASS}>
        {displayName}
        {param.required && <span className="ml-1 text-red-500">*</span>}
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <NumberField
          value={safeValue}
          onChange={(nextValue) => onChange(clampValue(nextValue, param))}
          min={param.min}
          max={param.max}
          step={step}
          precision={resolvePrecision(step)}
          placeholder={placeholderText}
          disabled={disabled}
          widthClassName="w-32"
          commitOnChange
          ariaLabel={displayName}
          increaseLabel={increaseLabel}
          decreaseLabel={decreaseLabel}
        />

        {param.unit && <span className={UI_TEXT_META_CLASS}>{param.unit}</span>}
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
              onClick={() => onChange(clampValue(mark.value, param))}
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
