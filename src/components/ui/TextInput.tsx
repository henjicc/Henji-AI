 

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
      {label ? <label className="block text-sm font-medium mb-1 text-zinc-300">{label}</label> : null}
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`bg-zinc-800/70 border border-zinc-700/50 rounded-lg px-3 py-2 h-[38px] text-sm outline-none focus:outline-none appearance-none focus:ring-inset focus:ring-2 focus:ring-[#007eff]/60 focus:ring-offset-0 focus:ring-offset-transparent focus:border-[#007eff] transition-shadow duration-300 ease-out ${inputClassName || 'w-full'}`}
      />
    </div>
  )
}
