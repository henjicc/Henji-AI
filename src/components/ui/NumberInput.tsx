import { useEffect, useRef, useState, type ReactElement } from 'react'
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
  /** 输入过程中只要是合法数字就实时提交（默认失焦/回车才提交），适合三维编辑等需要即时反馈的场景 */
  commitOnChange?: boolean
  /** 悬浮时滚轮直接步进并提交（无需先聚焦），会阻止容器滚动 */
  wheelStep?: boolean
}

function formatNumber(value: number, precision?: number): string {
  if (!Number.isFinite(value)) return '0'
  if (typeof precision !== 'number') return value.toString()

  const fixed = value.toFixed(precision)
  return fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

export default function NumberInput(props: NumberInputProps): ReactElement {
  const { label, value, onChange, min, max, step = 1, widthClassName = 'w-24', className, precision, disabled = false, commitOnChange = false, wheelStep = false } = props

  // 处理 undefined 值，使用 min 或 0 作为默认值
  const safeValue = value ?? (min ?? 0)
  const displayValue = formatNumber(safeValue, precision)

  // 使用内部状态存储输入值，允许用户输入过程中的中间状态
  const [inputValue, setInputValue] = useState(displayValue)
  const [isFocused, setIsFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const clamp = (v: number): number => {
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
  const handleBlur = (): void => {
    setIsFocused(false)
    const raw = parseFloat(inputValue)
    const next = clamp(isNaN(raw) ? (min ?? 0) : raw)
    onChange(next)
    setInputValue(formatNumber(next, precision))
  }
  
  // 获得焦点时更新输入值
  const handleFocus = (): void => {
    setIsFocused(true)
    setInputValue(displayValue)
  }

  // 当外部 value 变化且未聚焦时，同步到 inputValue
  if (!isFocused && displayValue !== inputValue) {
    setInputValue(displayValue)
  }

  const handleInputChange = (raw: string): void => {
    setInputValue(raw)
    if (!commitOnChange) return
    const parsed = parseFloat(raw)
    // 只有完整合法数字才实时提交，"-"、"1." 之类的中间态留到失焦再处理
    if (Number.isFinite(parsed) && String(parsed) === raw.trim()) {
      onChange(clamp(parsed))
    }
  }

  const stepBy = (direction: 1 | -1): void => {
    const next = clamp(safeValue + direction * step)
    onChange(next)
    setInputValue(formatNumber(next, precision))
  }

  // 悬浮滚轮步进：React 的 onWheel 是 passive 监听，preventDefault 无效，
  // 必须用原生非 passive 监听阻止容器滚动
  useEffect(() => {
    if (!wheelStep || disabled) return
    const element = inputRef.current
    if (!element) return
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      stepBy(event.deltaY < 0 ? 1 : -1)
    }
    element.addEventListener('wheel', handleWheel, { passive: false })
    return () => element.removeEventListener('wheel', handleWheel)
  })

  return (
    <div className={className}>
      {label ? <label className="block text-sm font-medium mb-1 text-zinc-300">{label}</label> : null}
      <div className={`relative inline-block ${widthClassName === 'w-full' ? 'w-full' : ''}`}>
        <UiInput
          ref={inputRef}
          type="number"
          value={inputValue}
          onChange={e => handleInputChange(e.target.value)}
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
            onClick={() => stepBy(1)}
            className="h-4 w-6 border-0 bg-transparent p-0 text-[10px] leading-none text-zinc-300 hover:text-zinc-200"
            disabled={disabled}
          >▲</UiIconButton>
          <UiIconButton
            type="button"
            showBorder={false}
            onClick={() => stepBy(-1)}
            className="h-4 w-6 border-0 bg-transparent p-0 text-[10px] leading-none text-zinc-300 hover:text-zinc-200"
            disabled={disabled}
          >▼</UiIconButton>
        </div>
      </div>
    </div>
  )
}
