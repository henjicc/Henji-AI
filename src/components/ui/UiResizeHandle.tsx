import React, { useRef } from 'react'

const KEYBOARD_STEP = 16

export interface UiResizeHandleProps {
  /** 读屏名称，例如“调整详情栏宽度” */
  label: string
  /** 当前尺寸（px） */
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  /** 拖完或键盘调整后调用，适合在这里记住尺寸 */
  onCommit?: (value: number) => void
  /** 往哪边拖是变大：end 向右（左侧栏、表格列），start 向左（右侧栏） */
  grow?: 'end' | 'start'
  /** pane：两块区域之间的竖条；column：表头单元格右缘（父级需 relative） */
  variant?: 'pane' | 'column'
}

const clamp = (value: number, min: number, max: number): number => Math.round(Math.min(max, Math.max(min, value)))

/** 拖动或用左右方向键调整相邻区域的宽度；侧栏宽度与表格列宽共用这一份。 */
export const UiResizeHandle: React.FC<UiResizeHandleProps> = ({ label, value, min, max, onChange, onCommit, grow = 'end', variant = 'pane' }) => {
  const latest = useRef(value)
  latest.current = value
  const sign = grow === 'end' ? 1 : -1

  const startDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startValue = latest.current
    const body = handle.ownerDocument.body
    body.style.cursor = 'col-resize'
    body.style.userSelect = 'none'
    const move = (next: PointerEvent): void => onChange(clamp(startValue + (next.clientX - startX) * sign, min, max))
    const end = (): void => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      body.style.cursor = ''
      body.style.userSelect = ''
      onCommit?.(latest.current)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  const resizeByKeyboard = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const next = clamp(latest.current + (event.key === 'ArrowRight' ? KEYBOARD_STEP : -KEYBOARD_STEP) * sign, min, max)
    onChange(next)
    onCommit?.(next)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={startDrag}
      onKeyDown={resizeByKeyboard}
      onClick={(event) => event.stopPropagation()}
      className={variant === 'pane'
        ? 'group relative z-raised -mx-1 flex w-2 shrink-0 cursor-col-resize justify-center outline-none'
        : 'group absolute -right-1 bottom-0 top-0 z-raised flex w-2 cursor-col-resize justify-center outline-none'}
      style={{ touchAction: 'none' }}
    >
      <span className={`h-full ${variant === 'pane' ? 'w-0.5' : 'w-px'} bg-transparent transition-colors duration-120 group-hover:bg-accent group-focus-visible:bg-accent`} />
    </div>
  )
}
