import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'

import { SCRUB_PIXELS_PER_STEP, SCRUB_START_THRESHOLD_PX, resolveScrubFactor } from './numberScrub'
import { UiInput, UiNumberStepper } from './primitives'
import {
  UI_FIELD_FOCUS_WITHIN_CLASS,
  UI_FIELD_LABEL_CLASS,
  UI_FIELD_SIZE_CLASS,
  UI_FIELD_SURFACE_CLASS,
  type UiFieldSize,
} from './styleTokens'
import type { ScopedTextHistoryBinding } from './useScopedTextHistory'

type NumberInputProps = {
  label?: string
  ariaLabel?: string
  value: number | undefined
  /** 有传时，Home 或双击读数/标签复位；同步正在编辑的读数与 Esc 基线。 */
  defaultValue?: number
  onChange: (next: number) => void
  min?: number
  max?: number
  step?: number
  /** 外框宽度（布局类）。读数比它长时外框按内容撑开，读数不会被裁切。 */
  widthClassName?: string
  className?: string
  precision?: number
  disabled?: boolean
  placeholder?: string
  /** 高度档：sm 28 / md 32（默认）/ lg 36，字号随档位。 */
  size?: UiFieldSize
  align?: 'left' | 'center' | 'right'
  widthStrategy?: 'fixed' | 'content'
  increaseLabel?: string
  decreaseLabel?: string
  textHistory?: ScopedTextHistoryBinding
  /** 输入过程中只要是合法数字就实时提交（默认失焦/回车才提交），适合三维编辑等需要即时反馈的场景 */
  commitOnChange?: boolean
  /** 悬浮时滚轮直接步进并提交（无需先聚焦），会阻止容器滚动 */
  wheelStep?: boolean
  /**
   * 数值拖动的手势边界（用于“一次拖动只记一步撤销”）：越过拖动阈值时 `onScrubStart`，
   * 松手 `onScrubEnd(false)`；拖动中按 Esc 或指针被系统取消时 `onScrubEnd(true)`，由调用方回到拖动前的值。
   * 不传时拖动中按 Esc 直接以拖动前的值调用一次 `onChange`。
   */
  onScrubStart?: () => void
  onScrubEnd?: (cancelled: boolean) => void
}

/** 键盘 Shift + 上下键一次走十个步长。 */
const KEYBOARD_COARSE_FACTOR = 10

/** 输入框左右内边距 + 步进列宽 + 余量（px）：外框最小宽度 = 读数字符数 × 1ch + 这个值，保证读数不被裁切。 */
const NUMBER_FIELD_CHROME_PX: Record<UiFieldSize, number> = { sm: 30, md: 34, lg: 38 }
const NUMBER_FIELD_INPUT_PADDING_CLASS: Record<UiFieldSize, string> = { sm: 'px-1.5', md: 'px-2', lg: 'px-2.5' }

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

type ScrubSession = {
  pointerId: number
  startX: number
  lastX: number
  startValue: number
  /** 已折算倍率后的累计位移（px）。中途切换修饰键不会让数值跳变。 */
  travel: number
  active: boolean
  lastCommitted: number
  /** 从输入框本身按下：未拖动就松开时进入编辑并全选读数。 */
  fromInput: boolean
}

/**
 * 数值字段：raised 字段表面 + 右侧步进列，支持**数值拖动**（设计稿“数值拖动字段”）：
 * - 在读数或标签上按住左右拖动改值（每 2px 一个步长），Shift 精细（十分之一）、Alt 粗调（十倍）；
 * - 单击读数进入键盘编辑（全选），回车或失焦提交；
 * - 聚焦时上下键步进，Shift + 上下键一次十个步长；可选悬停滚轮步进。
 * 外框最小宽度随读数长度，步进列不会把读数挤掉。
 */
export default function NumberInput(props: NumberInputProps): ReactElement {
  const {
    label,
    ariaLabel,
    value,
    defaultValue,
    onChange,
    min,
    max,
    step = 1,
    widthClassName = 'w-24',
    className,
    precision,
    disabled = false,
    placeholder,
    size = 'md',
    align = 'left',
    widthStrategy = 'fixed',
    increaseLabel = label ? `增加${label}` : '增加数值',
    decreaseLabel = label ? `减少${label}` : '减少数值',
    textHistory,
    commitOnChange = false,
    wheelStep = false,
    onScrubStart,
    onScrubEnd,
  } = props

  const safeValue = typeof value === 'number' && Number.isFinite(value) ? value : (min ?? 0)
  const effectivePrecision = precision ?? resolvePrecision(step)
  const displayValue = formatNumber(safeValue, effectivePrecision)
  const [inputValue, setInputValue] = useState(displayValue)
  const [isFocused, setIsFocused] = useState(false)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrubRef = useRef<ScrubSession | null>(null)
  /** 聚焦编辑开始时的值：Esc 放弃键盘输入时回到它（逐字提交的字段也撤回已提交的中间值）。 */
  const focusValueRef = useRef(safeValue)
  const escapingRef = useRef(false)
  const scrubEndRef = useRef({ onScrubEnd, onChange, effectivePrecision })
  scrubEndRef.current = { onScrubEnd, onChange, effectivePrecision }

  const clamp = useCallback((raw: number): number => {
    let next = raw
    if (typeof min === 'number') next = Math.max(min, next)
    if (typeof max === 'number') next = Math.min(max, next)
    const factor = 10 ** effectivePrecision
    return Math.round(next * factor) / factor
  }, [effectivePrecision, max, min])

  const handleBlur = (): void => {
    setIsFocused(false)
    if (escapingRef.current) {
      escapingRef.current = false
      setInputValue(formatNumber(focusValueRef.current, effectivePrecision))
      return
    }
    const parsed = Number.parseFloat(inputValue)
    const next = clamp(Number.isFinite(parsed) ? parsed : (min ?? 0))
    onChange(next)
    setInputValue(formatNumber(next, effectivePrecision))
  }

  const handleFocus = (): void => {
    setIsFocused(true)
    focusValueRef.current = safeValue
    setInputValue(displayValue)
  }

  const resetValue = (): void => {
    if (disabled || defaultValue === undefined || scrubRef.current?.active) return
    const next = clamp(defaultValue)
    focusValueRef.current = next
    setInputValue(formatNumber(next, effectivePrecision))
    onChange(next)
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

  const stepBy = useCallback((direction: 1 | -1, multiplier = 1): void => {
    const parsed = Number.parseFloat(inputValue)
    const base = Number.isFinite(parsed) ? parsed : safeValue
    const next = clamp(base + direction * step * multiplier)
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

  // 拖动时读数没有键盘焦点：Esc 在拖动所在窗口（可能是剪辑浮窗）的捕获阶段处理，只在拖动期间监听
  useEffect(() => {
    if (!isScrubbing) return
    const target = inputRef.current?.ownerDocument.defaultView
    if (!target) return
    const handleKey = (event: KeyboardEvent): void => {
      const session = scrubRef.current
      if (event.key !== 'Escape' || !session?.active) return
      event.preventDefault()
      event.stopPropagation()
      scrubRef.current = null
      setIsScrubbing(false)
      const { onScrubEnd: end, onChange: change, effectivePrecision: digits } = scrubEndRef.current
      setInputValue(formatNumber(session.startValue, digits))
      if (end) end(true)
      else change(session.startValue)
    }
    target.addEventListener('keydown', handleKey, true)
    return () => target.removeEventListener('keydown', handleKey, true)
  }, [isScrubbing])

  const beginScrub = (event: ReactPointerEvent<HTMLElement>, fromInput: boolean): void => {
    if (disabled || event.button !== 0) return
    // 正在键盘编辑时，读数上的按下是移动光标/选择文字，不是拖动
    if (fromInput && isFocused) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    scrubRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      lastX: event.clientX,
      startValue: safeValue,
      travel: 0,
      active: false,
      lastCommitted: safeValue,
      fromInput,
    }
  }

  const moveScrub = (event: ReactPointerEvent<HTMLElement>): void => {
    const session = scrubRef.current
    if (!session || session.pointerId !== event.pointerId) return
    if (!session.active) {
      if (Math.abs(event.clientX - session.startX) < SCRUB_START_THRESHOLD_PX) return
      session.active = true
      session.lastX = session.startX
      setIsScrubbing(true)
      onScrubStart?.()
    }
    session.travel += (event.clientX - session.lastX) * resolveScrubFactor(event)
    session.lastX = event.clientX
    const steps = Math.round(session.travel / SCRUB_PIXELS_PER_STEP)
    const next = clamp(session.startValue + steps * step)
    if (next === session.lastCommitted) return
    session.lastCommitted = next
    onChange(next)
    setInputValue(formatNumber(next, effectivePrecision))
  }

  const endScrub = (event: ReactPointerEvent<HTMLElement>): void => {
    const session = scrubRef.current
    if (!session || session.pointerId !== event.pointerId) return
    scrubRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    if (session.active) {
      setIsScrubbing(false)
      onScrubEnd?.(false)
      return
    }
    // 没有拖动：单击读数或标签进入编辑
    const input = inputRef.current
    if (!input) return
    input.focus()
    if (session.fromInput) input.select()
  }

  const cancelScrub = (event: ReactPointerEvent<HTMLElement>): void => {
    const session = scrubRef.current
    if (session?.pointerId !== event.pointerId) return
    scrubRef.current = null
    setIsScrubbing(false)
    if (session.active && onScrubEnd) {
      setInputValue(formatNumber(session.startValue, effectivePrecision))
      onScrubEnd(true)
    }
  }

  const scrubHandlers = (fromInput: boolean) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => beginScrub(event, fromInput),
    onPointerMove: moveScrub,
    onPointerUp: endScrub,
    onPointerCancel: cancelScrub,
    onLostPointerCapture: cancelScrub,
  })

  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
  const contentWidthCharacterCount = Math.max(inputValue.length, placeholder?.length ?? 0, 2)
  const minContentWidth = `calc(${contentWidthCharacterCount}ch + ${NUMBER_FIELD_CHROME_PX[size]}px)`
  const scrubCursorClass = disabled ? '' : isFocused ? 'cursor-text' : 'cursor-ew-resize'

  return (
    <div className={className}>
      {label ? (
        <label
          className={`${UI_FIELD_LABEL_CLASS} select-none ${disabled ? '' : 'cursor-ew-resize'}`}
          {...scrubHandlers(false)}
          onDoubleClick={resetValue}
        >
          {label}
        </label>
      ) : null}
      <div
        data-ui-field-control
        data-scrubbing={isScrubbing ? 'true' : undefined}
        className={`inline-flex overflow-hidden ${UI_FIELD_SIZE_CLASS[size]} ${widthStrategy === 'fixed' ? widthClassName : ''} ${UI_FIELD_SURFACE_CLASS} ${UI_FIELD_FOCUS_WITHIN_CLASS}`}
        style={widthStrategy === 'content' ? { width: minContentWidth } : { minWidth: minContentWidth }}
      >
        <UiInput
          ref={inputRef}
          type="number"
          inputMode="decimal"
          size={size}
          value={inputValue}
          onChange={(event) => handleInputChange(event.target.value)}
          onBlur={handleBlur}
          onFocus={handleFocus}
          {...scrubHandlers(true)}
          onDoubleClick={resetValue}
          onKeyDown={(event) => {
            if (disabled) return
            if (event.key === 'Home' && defaultValue !== undefined) {
              event.preventDefault()
              resetValue()
            }
            if (event.key === 'Enter') {
              event.currentTarget.blur()
            }
            if (event.key === 'Escape' && isFocused) {
              // 放弃这次键盘输入：回到聚焦时的值；逐字提交的字段把已提交的中间值撤回
              event.preventDefault()
              event.stopPropagation()
              escapingRef.current = true
              if (commitOnChange && clamp(Number.parseFloat(inputValue)) !== focusValueRef.current) onChange(focusValueRef.current)
              event.currentTarget.blur()
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              stepBy(1, event.shiftKey ? KEYBOARD_COARSE_FACTOR : 1)
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              stepBy(-1, event.shiftKey ? KEYBOARD_COARSE_FACTOR : 1)
            }
          }}
          textHistory={scopedTextHistory}
          aria-label={ariaLabel ?? label}
          aria-valuetext={inputValue}
          placeholder={placeholder}
          // 外框已经画了字段表面与焦点环：内层输入框只负责文字，铺满高度
          frame="inner"
          className={`!h-full min-w-0 flex-1 appearance-none tabular-nums ${NUMBER_FIELD_INPUT_PADDING_CLASS[size]} ${alignClass} ${scrubCursorClass}`}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
        />
        <UiNumberStepper
          size={size}
          increaseLabel={increaseLabel}
          decreaseLabel={decreaseLabel}
          disabled={disabled}
          canIncrease={!(typeof max === 'number' && safeValue >= max)}
          canDecrease={!(typeof min === 'number' && safeValue <= min)}
          onStep={(direction) => stepBy(direction)}
        />
      </div>
    </div>
  )
}
