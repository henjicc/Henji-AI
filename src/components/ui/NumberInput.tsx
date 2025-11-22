 
import { useState } from 'react'

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
  disabled?: boolean
}

export default function NumberInput(props: NumberInputProps) {
  const { label, value, onChange, min, max, step = 1, widthClassName = 'w-24', className, precision, disabled = false } = props
  
  // 使用内部状态存储输入值，允许用户输入过程中的中间状态
  const [inputValue, setInputValue] = useState(value.toString())
  const [isFocused, setIsFocused] = useState(false)
  
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
  
  // 失去焦点时验证和修正数值
  const handleBlur = () => {
    setIsFocused(false)
    const raw = parseFloat(inputValue)
    const next = clamp(isNaN(raw) ? (min ?? 0) : raw)
    onChange(next)
    setInputValue(next.toString())
  }
  
  // 获得焦点时更新输入值
  const handleFocus = () => {
    setIsFocused(true)
    setInputValue(value.toString())
  }
  
  // 当外部 value 变化且未聚焦时，同步到 inputValue
  if (!isFocused && value.toString() !== inputValue) {
    setInputValue(value.toString())
  }
  
  return (
    <div className={className}>
      {label ? <label className="block text-sm font-medium mb-1 text-zinc-300">{label}</label> : null}
      <div className="relative inline-block">
        <input
          type="number"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onBlur={handleBlur}
          onFocus={handleFocus}
          onKeyDown={e => {
            // 按 Enter 键时也触发验证
            if (e.key === 'Enter') {
              e.currentTarget.blur()
            }
          }}
          className={`${widthClassName} bg-zinc-800/70 backdrop-blur-lg border border-zinc-700/50 rounded-lg px-3 pr-8 py-2 h-[38px] text-sm outline-none focus:outline-none appearance-none focus:ring-inset focus:ring-2 focus:ring-[#007eff]/60 focus:ring-offset-0 focus:ring-offset-transparent focus:border-[#007eff] transition-shadow duration-300 ease-out ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
        />
        <div className="absolute inset-y-0 right-1 flex flex-col justify-center gap-1">
          <button
            type="button"
            onClick={() => {
              const next = clamp(value + step)
              onChange(next)
              setInputValue(next.toString())
            }}
            className="w-6 h-4 bg-transparent text-zinc-300 text-[10px] leading-none hover:text-zinc-200 outline-none focus:outline-none ring-0 focus:ring-0 cursor-pointer"
            disabled={disabled}
          >▲</button>
          <button
            type="button"
            onClick={() => {
              const next = clamp(value - step)
              onChange(next)
              setInputValue(next.toString())
            }}
            className="w-6 h-4 bg-transparent text-zinc-300 text-[10px] leading-none hover:text-zinc-200 outline-none focus:outline-none ring-0 focus:ring-0 cursor-pointer"
            disabled={disabled}
          >▼</button>
        </div>
      </div>
    </div>
  )
}
