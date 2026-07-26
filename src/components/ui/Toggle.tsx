import type { ReactNode } from 'react'
import { UiButton } from './primitives'
import { UI_FIELD_LABEL_CLASS } from './styleTokens'

type ToggleProps = {
  label?: ReactNode
  checked: boolean
  onChange: (next: boolean) => void
  onText?: string
  offText?: string
  className?: string
  disabled?: boolean
}

export default function Toggle(props: ToggleProps) {
  const { label, checked, onChange, onText = '开启', offText = '关闭', className, disabled = false } = props
  return (
    <div className={className}>
      {label ? <label className={UI_FIELD_LABEL_CLASS}>{label}</label> : null}
      <UiButton
        type="button"
        variant={disabled ? 'ghost' : 'muted'}
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className={`px-3 py-2 h-[38px] !text-15 leading-none rounded-lg border ${disabled
            ? 'bg-surface-dark/30 text-text-faint border-border-dark/30 cursor-not-allowed opacity-50'
            : checked
              ? '!bg-accent !text-white !border-accent hover:brightness-110'
              : 'bg-surface-dark/70 text-text-soft border-border-dark/50'
          }`}
      >
        {checked ? onText : offText}
      </UiButton>
    </div>
  )
}

