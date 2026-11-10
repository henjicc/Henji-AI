import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Dropdown } from '@/components/ui'

/**
 * 监视器缩放（Premiere 节目 / 源监视器）：
 * - 显示方式是“适合”或一个缩放比例；下拉给出常用等级（10%–1600%），滚轮以鼠标位置为中心无极缩放；
 * - 放大后按住鼠标中键拖动平移（滚动容器）；
 * - 选“适合”回到铺满。节目与源监视器共用。
 */
type MonitorDisplay = 'fit' | number
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
    // 一帧里的多次滚轮合成一次缩放：每次滚轮都改状态会让整块监视器连续重绘；缩放和滚动位置的修正放在同一帧里同步做完，
    // 不留“已经变大、还没滚回鼠标下”的中间帧（那一帧画面会跳一下）。
    let pending: { deltaY: number; clientX: number; clientY: number } | undefined
    let frame = 0
    const apply = (): void => {
      frame = 0
      const step = pending; pending = undefined
      const box = container.querySelector<HTMLElement>('[data-monitor-zoom-box]')
      if (!step || !box) return
      const boxRect = box.getBoundingClientRect()
      const shown = displayRef.current
      const current = shown === 'fit' ? boxRect.width / Math.max(1, width) : shown
      const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, current * Math.pow(1.0015, -step.deltaY)))
      if (Math.abs(next - current) < 1e-4) return
      // 以鼠标所在点为中心缩放：缩放后把同一画面点移回鼠标下
      const pointX = (step.clientX - boxRect.left) / current; const pointY = (step.clientY - boxRect.top) / current
      flushSync(() => setDisplay(next))
      displayRef.current = next
      const after = box.getBoundingClientRect()
      container.scrollLeft += after.left + pointX * next - step.clientX
      container.scrollTop += after.top + pointY * next - step.clientY
    }
    const wheel = (event: WheelEvent): void => {
      if (event.deltaY === 0 || event.ctrlKey) return
      if (!container.querySelector('[data-monitor-zoom-box]')) return
      event.preventDefault()
      pending = { deltaY: (pending?.deltaY ?? 0) + event.deltaY, clientX: event.clientX, clientY: event.clientY }
      frame ||= requestAnimationFrame(apply)
    }
    container.addEventListener('wheel', wheel, { passive: false })
    detach.current = () => { container.removeEventListener('wheel', wheel); cancelAnimationFrame(frame) }
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
    // 适合模式不能滚动：overflow-hidden 仍会被聚焦或 scrollIntoView 滚走（画面上的文字框平移出画幅时就有可滚动的溢出），clip 彻底不滚
    containerClass: display === 'fit' ? 'items-center justify-center overflow-clip' : 'overflow-auto',
    containerRef,
    containerProps,
    boxClass: display === 'fit' ? 'max-h-full max-w-full' : 'm-auto shrink-0',
    boxStyle: display === 'fit' ? { aspectRatio: `${width}/${height}`, height: '100%' } : { width: Math.round(width * display), height: Math.round(height * display) },
    dropdown: <Dropdown<string> ariaLabel={label} appearance="text" size="sm" value={String(display)} options={options} onSelect={(value) => setDisplay(value === 'fit' ? 'fit' : Number(value))} />,
  }
}
