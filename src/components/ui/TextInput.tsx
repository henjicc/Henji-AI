import { UiInput } from './primitives'

type TextInputProps = {
  label?: string
  value: string
  onChange: (next: string) => void
  placeholder?: string
  className?: string
  inputClassName?: string
}

export default function TextInput(props: TextInputProps) {
  const { label, value, onChange, placeholder, className, inputClassName } = props
  return (
    <div className={className}>
      {label ? <label className="block text-sm font-medium mb-1 text-text-soft">{label}</label> : null}
      <UiInput
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`h-[38px] ${inputClassName || 'w-full'}`}
      />
    </div>
  )
}
