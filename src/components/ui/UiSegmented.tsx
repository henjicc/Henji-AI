import type { UiControlSize } from './primitiveInternals'
import { useRef, type ReactNode } from 'react'
import { UiOptionButton } from './primitives'
import { UI_CONTROL_HEIGHT_CLASS } from './styleTokens'
import { useUiFormRowLabelling } from './formRowLabel'
import Dropdown from './Dropdown'

export interface UiSegmentedOption<T extends string | number> {
  value: T
  label: string
  icon?: ReactNode
  disabled?: boolean
  title?: string
  ariaLabel?: string
}

export interface UiSegmentedProps<T extends string | number> {
  ariaLabel: string
  options: readonly UiSegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  size?: UiControlSize
  fullWidth?: boolean
  disabled?: boolean
  /** 悬停/聚焦候选项时预览，离开时清除；不改变当前选择。 */
  onPreview?: (value: T | undefined) => void
}

/** 同一取值的等宽分段；单一 Tab 停靠点，方向键循环选择并跳过禁用项。 */
export function UiSegmented<T extends string | number>({ ariaLabel, options, value, onChange, size = 'md', fullWidth = false, disabled = false, onPreview }: UiSegmentedProps<T>): JSX.Element {
  const buttons = useRef(new Map<T, HTMLButtonElement>())
  const formRow = useUiFormRowLabelling()
  const fillControl = fullWidth || formRow?.fillControl === true
  const enabled = options.filter(option => !option.disabled)
  const tabValue = enabled.some(option => option.value === value) ? value : enabled[0]?.value
  if (options.length > 5 || options.some(option => [...option.label].length > 4)) return <Dropdown ariaLabel={ariaLabel} options={options.map(option => ({ ...option, tooltip: option.title }))} value={value} onSelect={onChange} onPreview={onPreview} size={size} className={fillControl ? 'w-full' : undefined} disabled={disabled} />
  return <div role="radiogroup" aria-label={ariaLabel} aria-disabled={disabled || undefined}
    className={`inline-grid auto-cols-fr grid-flow-col gap-0.5 rounded-lg bg-gap p-0.5 ${UI_CONTROL_HEIGHT_CLASS[size]} ${fillControl ? 'w-full' : 'w-fit'}`}>
    {/* ui-surface-allow: S1 u5 统一分段组件内部使用原语渲染选项，调用方必须用 UiSegmented。 */}
    {options.map(option => <UiOptionButton key={option.value} type="button" variant="segment" segmentFrame="inset" size={size}
      ref={button => { if (button) buttons.current.set(option.value, button); else buttons.current.delete(option.value) }}
      role="radio" aria-checked={value === option.value} tabIndex={!disabled && option.value === tabValue ? 0 : -1}
      active={value === option.value} disabled={disabled || option.disabled} tooltip={option.title} aria-label={option.ariaLabel}
      onMouseEnter={() => { if (!disabled && !option.disabled) onPreview?.(option.value) }} onMouseLeave={() => onPreview?.(undefined)}
      onFocus={() => { if (!disabled && !option.disabled) onPreview?.(option.value) }} onBlur={() => onPreview?.(undefined)}
      onClick={() => onChange(option.value)} onKeyDown={event => {
        if (disabled || option.disabled || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const current = enabled.findIndex(item => item.value === option.value)
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length
        const next = enabled[index]
        if (next) { buttons.current.get(next.value)?.focus(); onChange(next.value) }
      }}>{option.icon}{option.label}</UiOptionButton>)}
  </div>
}
