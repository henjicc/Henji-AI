import NumberInput from './NumberInput'
import { useRef } from 'react'
import type { ParameterControlProps } from './parameterControl'

/**
 * 参数图形（角度盘、色轮、区间滑杆）旁的数值读数：NumberInput 仍是唯一的数值编辑与拖动实现。
 * label 只作可访问名称，不显示：读数紧挨着行标签，再写一遍“××读数”是重复，窄面板里还会折行。
 */
export function ParameterNumber({ value, onChange, defaultValue, label, disabled, size = 'sm', onBegin, onFinish, onCancel, min, max, step = 1 }: ParameterControlProps<number> & { min?: number; max?: number; step?: number }) {
  const scrubbing = useRef(false)
  return <div className="min-w-0 flex-1">
    <NumberInput ariaLabel={label} value={value} defaultValue={defaultValue} min={min} max={max} step={step} size={size} disabled={disabled}
      widthClassName="w-full" onChange={next => { if (scrubbing.current) onChange(next); else if (!disabled) { onBegin(); onChange(next); onFinish() } }}
      onScrubStart={() => { scrubbing.current = true; onBegin() }} onScrubEnd={cancelled => { scrubbing.current = false; if (cancelled) onCancel(); else onFinish() }} />
  </div>
}
