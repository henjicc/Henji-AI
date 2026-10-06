import { useCallback, useEffect, useRef, useState } from 'react'
import { Dropdown } from '@/components/ui'

/**
 * 监视器缩放（Premiere 节目 / 源监视器）：
 * - 显示方式是“适合”或一个缩放比例；下拉给出常用等级（10%–1600%），滚轮以鼠标位置为中心无极缩放；
 * - 放大后按住鼠标中键拖动平移（滚动容器）；
 * - 选“适合”回到铺满。节目与源监视器共用。
 */
export type MonitorDisplay = 'fit' | number
const LEVELS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 4, 8, 16] as const
const MIN_SCALE = 0.05
const MAX_SCALE = 16

function percent(scale: number): string { return `${Math.round(scale * 100)}%` }

export interface MonitorZoom {
  display: MonitorDisplay
  setDisplay: (value: MonitorDisplay) => void
  /** 画面区（滚动容器）的布局类、事件与 ref（挂滚轮缩放）。 */
  containerClass: string
  containerRef: (element: HTMLDivElement | null) => void
  containerProps: Pick<React.HTMLAttributes<HTMLDivElement>, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onAuxClick'>
  /** 画面盒子的类与尺寸。 */
  boxClass: string
  boxStyle: React.CSSProperties
  /** 显示比例下拉（含当前非预设比例，如 21%）。 */
  dropdown: React.ReactElement
}

export function useMonitorZoom({ width, height, label }: { width: number; height: number; label: string }): MonitorZoom {
  const [display, setDisplay] = useState<MonitorDisplay>('fit')
  const pan = useRef<{ x: number; y: number; left: number; top: number; pointerId: number } | null>(null)

  // 滚轮缩放要阻止画面区自己滚动，只能用非被动的原生监听（React 的 onWheel 是被动的）
  const displayRef = useRef(display); displayRef.current = display
  const detach = useRef<(() => void) | null>(null)
  const containerRef = useCallback((container: HTMLDivElement | null): void => {
    detach.current?.(); detach.current = null
    if (!container) return
    const wheel = (event: WheelEvent): void => {
      if (event.deltaY === 0 || event.ctrlKey) return
      const box = container.querySelector<HTMLElement>('[data-monitor-zoom-box]')
      if (!box) return
      event.preventDefault()
      const boxRect = box.getBoundingClientRect()
      const shown = displayRef.current
      const current = shown === 'fit' ? boxRect.width / Math.max(1, width) : shown
      const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, current * Math.pow(1.0015, -event.deltaY)))
      if (Math.abs(next - current) < 1e-4) return
      // 以鼠标所在点为中心缩放：缩放后把同一画面点移回鼠标下
      const pointX = (event.clientX - boxRect.left) / current; const pointY = (event.clientY - boxRect.top) / current
      setDisplay(next)
      requestAnimationFrame(() => {
        const after = container.querySelector<HTMLElement>('[data-monitor-zoom-box]')?.getBoundingClientRect()
        if (!after) return
        container.scrollLeft += after.left + pointX * next - event.clientX
        container.scrollTop += after.top + pointY * next - event.clientY
      })
    }
    container.addEventListener('wheel', wheel, { passive: false })
    detach.current = () => container.removeEventListener('wheel', wheel)
  }, [width])
  useEffect(() => () => { detach.current?.() }, [])

  const containerProps: MonitorZoom['containerProps'] = {
    onPointerDown: (event) => {
      if (event.button !== 1) return
      // 中键拖动平移，不触发浏览器自动滚动
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      pan.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop, pointerId: event.pointerId }
    },
    onPointerMove: (event) => {
      const state = pan.current
      if (!state || state.pointerId !== event.pointerId) return
      event.currentTarget.scrollLeft = state.left - (event.clientX - state.x)
      event.currentTarget.scrollTop = state.top - (event.clientY - state.y)
    },
    onPointerUp: (event) => { if (pan.current?.pointerId === event.pointerId) pan.current = null },
    onPointerCancel: () => { pan.current = null },
    onAuxClick: (event) => { if (event.button === 1) event.preventDefault() },
  }

  const options = [
    { value: 'fit', label: '适合' },
    ...LEVELS.map((scale) => ({ value: String(scale), label: percent(scale) })),
    ...(typeof display === 'number' && !LEVELS.some((scale) => Math.abs(scale - display) < 1e-4) ? [{ value: String(display), label: percent(display) }] : []),
  ]
  return {
    display,
    setDisplay,
    containerClass: display === 'fit' ? 'items-center justify-center overflow-hidden' : 'overflow-auto',
    containerRef,
    containerProps,
    boxClass: display === 'fit' ? 'max-h-full max-w-full' : 'm-auto shrink-0',
    boxStyle: display === 'fit' ? { aspectRatio: `${width}/${height}`, height: '100%' } : { width: Math.round(width * display), height: Math.round(height * display) },
    dropdown: <Dropdown<string> ariaLabel={label} appearance="text" size="sm" value={String(display)} options={options} onSelect={(value) => setDisplay(value === 'fit' ? 'fit' : Number(value))} />,
  }
}
