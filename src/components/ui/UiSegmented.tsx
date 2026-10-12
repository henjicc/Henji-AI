import { useRef, type ReactNode } from 'react'
import { UiOptionButton } from './primitives'
import { UI_CONTROL_HEIGHT_CLASS } from './styleTokens'

export interface UiSegmentedOption<T extends string | number> {
  value: T
  label: string
  icon?: ReactNode
  disabled?: boolean
  title?: string
}

export interface UiSegmentedProps<T extends string | number> {
  ariaLabel: string
  options: readonly UiSegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  fullWidth?: boolean
  disabled?: boolean
}

/** 同一取值的等宽分段；单一 Tab 停靠点，方向键循环选择并跳过禁用项。 */
export function UiSegmented<T extends string | number>({ ariaLabel, options, value, onChange, size = 'md', fullWidth = false, disabled = false }: UiSegmentedProps<T>): JSX.Element {
  const buttons = useRef(new Map<T, HTMLButtonElement>())
  const enabled = options.filter(option => !option.disabled)
  const tabValue = enabled.some(option => option.value === value) ? value : enabled[0]?.value
  return <div role="radiogroup" aria-label={ariaLabel} aria-disabled={disabled || undefined}
    className={`inline-flex gap-0.5 rounded-lg bg-gap p-0.5 ${UI_CONTROL_HEIGHT_CLASS[size]} ${fullWidth ? 'w-full' : 'w-fit'}`}>
    {options.map(option => <UiOptionButton key={option.value} variant="segment" segmentFrame="inset" size={size}
      ref={button => { if (button) buttons.current.set(option.value, button); else buttons.current.delete(option.value) }}
      role="radio" aria-checked={value === option.value} tabIndex={!disabled && option.value === tabValue ? 0 : -1}
      active={value === option.value} disabled={disabled || option.disabled} title={option.title} className="flex-1 basis-0"
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
