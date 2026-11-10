/**
 * Schema 数字参数：标签、单位与快捷刻度由这里编排，输入和竖排步进器复用通用 NumberInput。
 */

import React, { useContext } from 'react'
import { useTranslation } from 'react-i18next'

import NumberField from '@/components/ui/NumberInput'
import {
  UI_TEXT_META_CLASS,
  UiOptionButton,
  UiRangeInput,
  UiReadout,
} from '@/components/ui'
import { ParamChoicesExpandedContext } from '../paramPanelRows'
import type { NumberParamDef } from '@/core/types'
import { getI18nText } from '@/core/types/I18nText'
import { ParamLabel } from '../ParamLabel'
import { ParamField } from '../ParamField'

/** 档数再多拖动就不准了，改回数值框 */
const SLIDER_MAX_STEPS = 100

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

  // 摊开排布（左侧输入面板）里有上下限、档数不多的数值直接用滑块，读数跟在右边
  const expanded = useContext(ParamChoicesExpandedContext)
  // 只有声明了步长才知道是整数还是小数，没写步长的不猜，仍用数值框
  const sliderSteps = typeof param.min === 'number' && typeof param.max === 'number' && param.step ? (param.max - param.min) / param.step : Infinity
  if (expanded && !hasMarks && sliderSteps > 0 && sliderSteps <= SLIDER_MAX_STEPS) {
    return (
      <ParamField>
        <ParamLabel param={param} language={i18n.language} />
        <div className="flex w-full items-center gap-2">
          <UiRangeInput
            min={param.min}
            max={param.max}
            step={step}
            value={safeValue}
            disabled={disabled}
            aria-label={displayName}
            onChange={(event) => onChange(clampValue(Number(event.target.value), param))}
          />
          <UiReadout size="sm">{safeValue}{param.unit ? ` ${param.unit}` : ''}</UiReadout>
        </div>
      </ParamField>
    )
  }

  return (
    <ParamField className={hasMarks ? 'w-auto min-w-[200px]' : 'w-fit'} inline={!hasMarks}>
      <ParamLabel param={param} language={i18n.language} />

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
          widthStrategy="content"
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
              size="sm"
            >
              {mark.label}
            </UiOptionButton>
          ))}
        </div>
      )}
    </ParamField>
  )
}
