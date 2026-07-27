import { UiInput } from './primitives'
import { UI_FIELD_CONTROL_HEIGHT_SM_CLASS, UI_FIELD_LABEL_CLASS } from './styleTokens'

type TextInputProps = {
  label?: string
  value: string
  onChange: (next: string) => void
  placeholder?: string
  className?: string
  inputClassName?: string
}

export default function TextInput(props: TextInputProps): JSX.Element {
  const { label, value, onChange, placeholder, className, inputClassName } = props
  return (
    <div className={className}>
      {label ? <label className={UI_FIELD_LABEL_CLASS}>{label}</label> : null}
      <UiInput
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${UI_FIELD_CONTROL_HEIGHT_SM_CLASS} ${inputClassName || 'w-full'}`}
      />
    </div>
  )
}
