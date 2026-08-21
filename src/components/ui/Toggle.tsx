import { useId, type ReactNode } from 'react'
import { UiSwitch } from './primitives'
import { UI_FIELD_LABEL_CLASS } from './styleTokens'

type ToggleProps = {
  label?: ReactNode
  checked: boolean
  onChange: (next: boolean) => void
  onText?: string
  offText?: string
  className?: string
  disabled?: boolean
  ariaLabel?: string
}

export default function Toggle(props: ToggleProps): JSX.Element {
  const {
    label,
    checked,
    onChange,
    onText = '开',
    offText = '关',
    className,
    disabled = false,
    ariaLabel,
  } = props
  const labelId = useId()

  return (
    <div className={`flex min-w-0 items-center justify-between gap-3 ${className ?? ''}`}>
      {label ? <span id={labelId} className={`min-w-0 ${UI_FIELD_LABEL_CLASS}`}>{label}</span> : null}
      <UiSwitch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-labelledby={label ? labelId : undefined}
        aria-label={label ? undefined : ariaLabel ?? (checked ? onText : offText)}
        title={checked ? onText : offText}
        className="shrink-0"
      />
    </div>
  )
}
