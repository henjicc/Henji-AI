 

type NumberInputProps = {
  label?: string
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
  step?: number
  widthClassName?: string
  className?: string
  precision?: number
}

export default function NumberInput(props: NumberInputProps) {
  const { label, value, onChange, min, max, step = 1, widthClassName = 'w-24', className, precision } = props
  const clamp = (v: number) => {
    let x = v
    if (typeof min === 'number') x = Math.max(min, x)
    if (typeof max === 'number') x = Math.min(max, x)
    if (typeof precision === 'number') {
      const p = Math.pow(10, precision)
      x = Math.round(x * p) / p
    }
    return x
  }
  return (
    <div className={className}>
      {label ? <label className="block text-sm font-medium mb-1 text-zinc-300">{label}</label> : null}
      <div className="relative inline-block">
        <input
          type="number"
          value={typeof precision === 'number' ? clamp(value).toFixed(precision) : value}
          onChange={e => {
            const raw = parseFloat(e.target.value)
            const next = clamp(isNaN(raw) ? (min ?? 0) : raw)
            onChange(next)
          }}
          className={`${widthClassName} bg-zinc-800/70 backdrop-blur-lg border border-zinc-700/50 rounded-lg px-3 pr-8 py-2 h-[38px] text-sm outline-none focus:outline-none appearance-none focus:ring-inset focus:ring-2 focus:ring-[#007eff]/60 focus:ring-offset-0 focus:ring-offset-transparent focus:border-[#007eff] transition-shadow duration-300 ease-out`}
          min={min}
          max={max}
          step={step}
        />
        <div className="absolute inset-y-0 right-1 flex flex-col justify-center gap-1">
          <button
            type="button"
            onClick={() => onChange(clamp(value + step))}
            className="w-6 h-4 bg-transparent text-zinc-300 text-[10px] leading-none hover:text-zinc-200 outline-none focus:outline-none ring-0 focus:ring-0 cursor-pointer"
          >▲</button>
          <button
            type="button"
            onClick={() => onChange(clamp(value - step))}
            className="w-6 h-4 bg-transparent text-zinc-300 text-[10px] leading-none hover:text-zinc-200 outline-none focus:outline-none ring-0 focus:ring-0 cursor-pointer"
          >▼</button>
        </div>
      </div>
    </div>
  )
}
