

type ToggleProps = {
  label?: string
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
      {label ? <label className="block text-sm font-medium mb-1 text-zinc-300">{label}</label> : null}
      <button
        type="button"
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className={`px-3 py-2 h-[38px] rounded-lg border ${disabled
            ? 'bg-zinc-800/30 text-zinc-500 border-zinc-700/30 cursor-not-allowed opacity-50'
            : checked
              ? 'bg-[#007eff] text-white border-[#007eff]'
              : 'bg-zinc-800/70 text-zinc-300 border-zinc-700/50'
          }`}
      >
        {checked ? onText : offText}
      </button>
    </div>
  )
}
