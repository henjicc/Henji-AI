import { useMemo, useRef } from 'react'
import { UiButton } from '@/components/ui'
import { clampViewport, sampleWaveform, waveformReference, type WaveformViewport } from './waveformViewport'

export function AudioEditOverview({ duration, sampleRate, sourceFrame, peaks, view, onChange }: {
  duration: number; sampleRate: number; sourceFrame: number; peaks: number[]; view: WaveformViewport; onChange: (view: WaveformViewport) => void
}) {
  const drag = useRef<{ pointer: number; x: number; width: number; view: WaveformViewport; edge: string } | null>(null)
  const bars = useMemo(() => sampleWaveform(peaks, { start: 0, end: duration }, duration, 250, waveformReference(peaks)), [peaks, duration])
  const minimum = Math.min(duration, sampleRate * 2)
  return <div className="relative mt-2 h-7 touch-none select-none overflow-hidden bg-bg-dark" aria-label="全局时间导航" title="拖动选框平移，拖动左右边缘缩放，点击空白快速定位"
    onPointerDown={(event) => {
      if (event.button !== 0 || duration <= 0) return
      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect()
      const target = event.target instanceof Element ? event.target.closest('[data-overview-edge]') : null
      const edge = target?.getAttribute('data-overview-edge') ?? 'jump'
      const next = edge === 'jump' ? clampViewport((event.clientX - rect.left) / rect.width * duration - (view.end - view.start) / 2, view.end - view.start, duration) : view
      onChange(next)
      drag.current = { pointer: event.pointerId, x: event.clientX, width: rect.width, view: next, edge }
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={(event) => {
      const current = drag.current
      if (!current || current.pointer !== event.pointerId) return
      const delta = (event.clientX - current.x) / Math.max(1, current.width) * duration
      if (current.edge === 'left') onChange({ start: Math.max(0, Math.min(current.view.end - minimum, current.view.start + delta)), end: current.view.end })
      else if (current.edge === 'right') onChange({ start: current.view.start, end: Math.min(duration, Math.max(current.view.start + minimum, current.view.end + delta)) })
      else onChange(clampViewport(current.view.start + delta, current.view.end - current.view.start, duration))
    }}
    onPointerUp={(event) => { if (drag.current?.pointer === event.pointerId) { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId) } }}
    onLostPointerCapture={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
    <svg className="pointer-events-none absolute inset-0 h-full w-full text-text-muted" viewBox="0 0 250 40" preserveAspectRatio="none" aria-hidden="true">{bars.map((peak, index) => <rect key={index} x={index} y={20 - peak * 18} width={0.7} height={Math.max(1, peak * 36)} fill="currentColor" />)}</svg>
    <div data-overview-edge="move" className="absolute inset-y-0 cursor-grab border border-accent bg-accent/20 active:cursor-grabbing" style={{ left: `${view.start / Math.max(1, duration) * 100}%`, width: `${(view.end - view.start) / Math.max(1, duration) * 100}%` }}>
      {(['left', 'right'] as const).map((edge) => <UiButton key={edge} data-overview-edge={edge} variant="plain" title={edge === 'left' ? '拖动调整可见起点' : '拖动调整可见终点'} className={`!absolute inset-y-0 !h-full !min-h-0 !w-3 !rounded-none !p-0 cursor-ew-resize ${edge === 'left' ? 'left-0' : 'right-0'}`}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          const delta = (event.key === 'ArrowLeft' ? -1 : 1) * duration / 100
          onChange(edge === 'left' ? { start: Math.max(0, Math.min(view.end - minimum, view.start + delta)), end: view.end } : { start: view.start, end: Math.min(duration, Math.max(view.start + minimum, view.end + delta)) })
        }}><span className="h-4 w-1 bg-accent" /></UiButton>)}
    </div>
    <div className="pointer-events-none absolute inset-y-0 w-px bg-text-dark" style={{ left: `${Math.max(0, Math.min(99.95, sourceFrame / Math.max(1, duration) * 100))}%` }} />
  </div>
}
