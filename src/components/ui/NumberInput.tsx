import { useState } from 'react'
import { UiIconButton, UiInput } from './primitives'

type NumberInputProps = {
  label?: string
  value: number | undefined
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

  // 处理 undefined 值，使用 min 或 0 作为默认值
  const safeValue = value ?? (min ?? 0)

  // 使用内部状态存储输入值，允许用户输入过程中的中间状态
  const [inputValue, setInputValue] = useState(safeValue.toString())
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
    setInputValue(safeValue.toString())
  }

  // 当外部 value 变化且未聚焦时，同步到 inputValue
  if (!isFocused && safeValue.toString() !== inputValue) {
    setInputValue(safeValue.toString())
  }
  
  return (
    <div className={className}>
      {label ? <label className="block text-sm font-medium mb-1 text-zinc-300">{label}</label> : null}
      <div className="relative inline-block">
        <UiInput
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
          className={`${widthClassName} h-[38px] appearance-none pr-8`}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
        />
        <div className="absolute inset-y-0 right-1 flex flex-col justify-center gap-1">
          <UiIconButton
            type="button"
            showBorder={false}
            onClick={() => {
              const next = clamp(safeValue + step)
              onChange(next)
              setInputValue(next.toString())
            }}
            className="h-4 w-6 border-0 bg-transparent p-0 text-[10px] leading-none text-zinc-300 hover:text-zinc-200"
            disabled={disabled}
          >▲</UiIconButton>
          <UiIconButton
            type="button"
            showBorder={false}
            onClick={() => {
              const next = clamp(safeValue - step)
              onChange(next)
              setInputValue(next.toString())
            }}
            className="h-4 w-6 border-0 bg-transparent p-0 text-[10px] leading-none text-zinc-300 hover:text-zinc-200"
            disabled={disabled}
          >▼</UiIconButton>
        </div>
      </div>
    </div>
  )
}
