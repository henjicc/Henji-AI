import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

import { UiIconButton, UiInput } from './primitives'
import {
  UI_FIELD_CONTROL_HEIGHT_SM_CLASS,
  UI_FIELD_FOCUS_WITHIN_CLASS,
  UI_FIELD_LABEL_CLASS,
  UI_FIELD_SURFACE_CLASS,
  UI_GLASS_ADAPTIVE_CONTROL_CLASS,
} from './styleTokens'
import type { ScopedTextHistoryBinding } from './useScopedTextHistory'

type NumberInputProps = {
  label?: string
  ariaLabel?: string
  value: number | undefined
  onChange: (next: number) => void
  min?: number
  max?: number
  step?: number
  widthClassName?: string
  className?: string
  precision?: number
  disabled?: boolean
  placeholder?: string
  size?: 'field' | 'compact'
  align?: 'left' | 'center' | 'right'
  increaseLabel?: string
  decreaseLabel?: string
  textHistory?: ScopedTextHistoryBinding
  /** 输入过程中只要是合法数字就实时提交（默认失焦/回车才提交），适合三维编辑等需要即时反馈的场景 */
  commitOnChange?: boolean
  /** 悬浮时滚轮直接步进并提交（无需先聚焦），会阻止容器滚动 */
  wheelStep?: boolean
}

function resolvePrecision(step: number): number {
  const normalized = String(step).toLowerCase()
  if (normalized.includes('e-')) {
    const [, exponent = '0'] = normalized.split('e-')
    return Number.parseInt(exponent, 10) || 0
  }
  const fraction = normalized.split('.')[1]
  return fraction ? fraction.length : 0
}

function formatNumber(value: number, precision?: number): string {
  if (!Number.isFinite(value)) return '0'
  if (typeof precision !== 'number') return value.toString()

  const fixed = value.toFixed(precision)
  return fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

export default function NumberInput(props: NumberInputProps): ReactElement {
  const {
    label,
    ariaLabel,
    value,
    onChange,
    min,
    max,
    step = 1,
    widthClassName = 'w-24',
    className,
    precision,
    disabled = false,
    placeholder,
    size = 'field',
    align = 'left',
    increaseLabel = label ? `增加${label}` : '增加数值',
    decreaseLabel = label ? `减少${label}` : '减少数值',
    textHistory,
    commitOnChange = false,
    wheelStep = false,
  } = props

  const safeValue = typeof value === 'number' && Number.isFinite(value) ? value : (min ?? 0)
  const effectivePrecision = precision ?? resolvePrecision(step)
  const displayValue = formatNumber(safeValue, effectivePrecision)
  const [inputValue, setInputValue] = useState(displayValue)
  const [isFocused, setIsFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const clamp = useCallback((raw: number): number => {
    let next = raw
    if (typeof min === 'number') next = Math.max(min, next)
    if (typeof max === 'number') next = Math.min(max, next)
    const factor = 10 ** effectivePrecision
    return Math.round(next * factor) / factor
  }, [effectivePrecision, max, min])

  const handleBlur = (): void => {
    setIsFocused(false)
    const parsed = Number.parseFloat(inputValue)
    const next = clamp(Number.isFinite(parsed) ? parsed : (min ?? 0))
    onChange(next)
    setInputValue(formatNumber(next, effectivePrecision))
  }

  const handleFocus = (): void => {
    setIsFocused(true)
    setInputValue(displayValue)
  }

  useEffect(() => {
    if (!isFocused) {
      setInputValue(displayValue)
    }
  }, [displayValue, isFocused])

  const handleInputChange = (raw: string): void => {
    setInputValue(raw)
    if (!commitOnChange || raw.trim() === '') return
    const parsed = Number.parseFloat(raw)
    if (Number.isFinite(parsed)) {
      onChange(clamp(parsed))
    }
  }

  const stepBy = useCallback((direction: 1 | -1): void => {
    const parsed = Number.parseFloat(inputValue)
    const base = Number.isFinite(parsed) ? parsed : safeValue
    const next = clamp(base + direction * step)
    onChange(next)
    setInputValue(formatNumber(next, effectivePrecision))
  }, [clamp, effectivePrecision, inputValue, onChange, safeValue, step])

  const scopedTextHistory = useMemo<ScopedTextHistoryBinding | undefined>(() => {
    if (!textHistory) return undefined
    return {
      ...textHistory,
      onValueChange: (nextValue) => {
        setInputValue(nextValue)
        textHistory.onValueChange(nextValue)
      },
    }
  }, [textHistory])

  useEffect(() => {
    if (!wheelStep || disabled) return
    const element = inputRef.current
    if (!element) return
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      stepBy(event.deltaY < 0 ? 1 : -1)
    }
    element.addEventListener('wheel', handleWheel, { passive: false })
    return () => element.removeEventListener('wheel', handleWheel)
  }, [disabled, stepBy, wheelStep])

  const compact = size === 'compact'
  const controlHeightClass = compact ? 'h-7' : UI_FIELD_CONTROL_HEIGHT_SM_CLASS
  const controlRadiusClass = compact ? 'rounded-md' : 'rounded-lg'
  const stepperWidthClass = compact ? 'w-5' : 'w-7'
  const stepperButtonWidthClass = compact ? '!w-5' : '!w-7'
  const iconSizeClass = compact ? 'h-3 w-3' : 'h-3.5 w-3.5'
  const textSizeClass = compact ? 'text-xs' : 'text-sm'
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'

  return (
    <div className={className}>
      {label ? <label className={UI_FIELD_LABEL_CLASS}>{label}</label> : null}
      <div
        data-ui-field-control
        className={`inline-flex overflow-hidden ${controlHeightClass} ${controlRadiusClass} ${widthClassName} ${UI_FIELD_SURFACE_CLASS} ${UI_GLASS_ADAPTIVE_CONTROL_CLASS} ${UI_FIELD_FOCUS_WITHIN_CLASS}`}
      >
        <UiInput
          ref={inputRef}
          type="number"
          inputMode="decimal"
          value={inputValue}
          onChange={(event) => handleInputChange(event.target.value)}
          onBlur={handleBlur}
          onFocus={handleFocus}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur()
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              stepBy(1)
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              stepBy(-1)
            }
          }}
          textHistory={scopedTextHistory}
          aria-label={ariaLabel ?? label}
          placeholder={placeholder}
          className={`!h-full !min-h-0 !w-auto min-w-0 flex-1 appearance-none rounded-none !border-0 !bg-transparent px-2 py-0 ${textSizeClass} ${alignClass}`}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
        />
        <div className={`flex shrink-0 flex-col border-l border-border-dark ${stepperWidthClass}`}>
          <UiIconButton
            type="button"
            showBorder={false}
            appearance="color-only"
            tabIndex={-1}
            data-ui-compact-stepper-button
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              stepBy(1)
            }}
            className={`!h-1/2 !rounded-none !border-0 !p-0 ${stepperButtonWidthClass}`}
            title={increaseLabel}
            aria-label={increaseLabel}
            disabled={disabled || (typeof max === 'number' && safeValue >= max)}
          >
            <ChevronUp className={iconSizeClass} />
          </UiIconButton>
          <UiIconButton
            type="button"
            showBorder={false}
            appearance="color-only"
            tabIndex={-1}
            data-ui-compact-stepper-button
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              stepBy(-1)
            }}
            className={`!h-1/2 !rounded-none !border-0 !p-0 ${stepperButtonWidthClass}`}
            title={decreaseLabel}
            aria-label={decreaseLabel}
            disabled={disabled || (typeof min === 'number' && safeValue <= min)}
          >
            <ChevronDown className={iconSizeClass} />
          </UiIconButton>
        </div>
      </div>
    </div>
  )
}
