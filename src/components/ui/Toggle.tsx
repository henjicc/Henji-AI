 

type ToggleProps = {
  label?: string
  checked: boolean
  onChange: (next: boolean) => void
  onText?: string
  offText?: string
  className?: string
}

export default function Toggle(props: ToggleProps) {
  const { label, checked, onChange, onText = '开启', offText = '关闭', className } = props
  return (
    <div className={className}>
      {label ? <label className="block text-sm font-medium mb-1 text-zinc-300">{label}</label> : null}
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`px-3 py-2 h-[38px] rounded-lg border ${checked ? 'bg-[#007eff] text-white border-[#007eff]' : 'bg-zinc-800/70 text-zinc-300 border-zinc-700/50'}`}
      >
        {checked ? onText : offText}
      </button>
    </div>
  )
}
