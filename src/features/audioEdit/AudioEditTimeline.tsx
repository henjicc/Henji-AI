import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { UiButton, UiIconButton, UI_TEXT_META_CLASS } from '@/components/ui'
import { buildAudioEditTimeline, editedDurationFrames } from '@/core/audioEdit/timeline'
import type { AudioEditProjectDocument } from '@/core/audioEdit/types'
import { useAudioEditPlaybackStore } from './store/audioEditPlaybackStore'
import { clampViewport, sampleWaveform, waveformReference, zoomViewport } from './waveformViewport'

function time(frame: number, rate: number) {
  const seconds = Math.max(0, frame / rate)
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`
}

export const AudioEditTimeline = memo(function AudioEditTimeline({ project, peaks, onSeek, onToggle }: {
  project: AudioEditProjectDocument
  peaks: number[]
  onSeek: (frame: number) => void
  onToggle: () => Promise<void>
}) {
  const { durationFrames: duration, sampleRate: rate } = project.source
  const sourceFrame = useAudioEditPlaybackStore((state) => state.sourceFrame)
  const outputFrame = useAudioEditPlaybackStore((state) => state.outputFrame)
  const playing = useAudioEditPlaybackStore((state) => state.playing)
  const preparing = useAudioEditPlaybackStore((state) => state.preparing)
  const ready = useAudioEditPlaybackStore((state) => state.ready)
  const error = useAudioEditPlaybackStore((state) => state.error)
  const [view, setView] = useState({ start: 0, end: duration })
  const [width, setWidth] = useState(800)
  const container = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointer: number; x: number; start: number; length: number } | null>(null)
  const followAfter = useRef(0)
  const spans = useMemo(() => buildAudioEditTimeline(duration, project.transcript), [duration, project.transcript])
  const removed = useMemo(() => {
    const ranges: Array<{ start: number; end: number }> = []
    let cursor = 0
    for (const span of spans) {
      if (cursor < span.sourceStartFrame) ranges.push({ start: cursor, end: span.sourceStartFrame })
      cursor = span.sourceEndFrame
    }
    if (cursor < duration) ranges.push({ start: cursor, end: duration })
    return ranges
  }, [duration, spans])
  const reference = useMemo(() => waveformReference(peaks), [peaks])
  const bars = useMemo(() => sampleWaveform(peaks, view, duration, Math.min(1000, width / 3), reference), [peaks, view, duration, width, reference])
  const barElements = useMemo(() => bars.map((peak, index) => {
    const frame = view.start + (index + 0.5) / bars.length * (view.end - view.start)
    const deleted = removed.some((range) => frame >= range.start && frame < range.end)
    return <rect key={index} x={index + 0.15} y={50 - peak * 46} width={0.7} height={Math.max(0.6, peak * 92)} className={deleted ? 'text-red-400' : undefined} fill="currentColor" />
  }), [bars, removed, view])
  const length = Math.max(1, view.end - view.start)
  const position = (frame: number) => (frame - view.start) / length * 100
  const pauseFollow = () => { followAfter.current = Date.now() + 3000 }

  useEffect(() => { setView({ start: 0, end: duration }) }, [duration, project.id])
  useEffect(() => {
    const element = container.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return
      event.preventDefault()
      followAfter.current = Date.now() + 3000
      const rect = element.getBoundingClientRect()
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1)
      setView((current) => zoomViewport(current, (event.clientX - rect.left) / Math.max(1, rect.width), Math.exp(Math.max(-1, Math.min(1, delta * 0.002))), duration, rate * 2))
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => { observer.disconnect(); element.removeEventListener('wheel', wheel) }
  }, [duration, rate])
  useEffect(() => {
    if (!playing || drag.current || Date.now() < followAfter.current) return
    if (sourceFrame < view.start || sourceFrame >= view.end) setView(clampViewport(sourceFrame - length * 0.15, length, duration))
  }, [duration, length, playing, sourceFrame, view])

  return (
    <div className="shrink-0 border-t border-border-dark p-3">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <UiIconButton className="h-9 w-9" disabled={!ready || editedDurationFrames(spans) === 0} onClick={() => void onToggle()} title={playing ? '暂停' : '播放'}>{playing ? <Pause size={16} /> : <Play size={16} />}</UiIconButton>
        <span className="text-sm tabular-nums text-text-dark" data-audio-edit-time>成片 {time(outputFrame, rate)} / {time(editedDurationFrames(spans), rate)}</span>
        <span className={UI_TEXT_META_CLASS}>素材 {time(sourceFrame, rate)}</span>
        {preparing && <span className={UI_TEXT_META_CLASS}>正在准备预览…</span>}
        {error && <span className="text-sm text-red-400">{error}</span>}
        <UiButton variant="ghost" size="sm" className="ml-auto" onClick={() => { pauseFollow(); setView({ start: 0, end: duration }) }}>显示全部</UiButton>
      </div>
      <div ref={container} role="slider" tabIndex={0} aria-label="口播波形定位" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={sourceFrame} aria-valuetext={time(sourceFrame, rate)}
        data-view-start={view.start} data-view-end={view.end}
        className="relative h-[clamp(8rem,18vh,14rem)] touch-none select-none overflow-hidden bg-bg-dark outline-none focus-visible:ring-1 focus-visible:ring-accent"
        onAuxClick={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (event.button !== 0 && event.button !== 1) return
          event.preventDefault()
          event.currentTarget.focus()
          pauseFollow()
          if (event.button === 1) {
            drag.current = { pointer: event.pointerId, x: event.clientX, start: view.start, length }
            event.currentTarget.setPointerCapture(event.pointerId)
          } else {
            const rect = event.currentTarget.getBoundingClientRect()
            onSeek(Math.round(view.start + Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * length))
          }
        }}
        onPointerMove={(event) => {
          if (!drag.current || drag.current.pointer !== event.pointerId) return
          pauseFollow()
          setView(clampViewport(drag.current.start - (event.clientX - drag.current.x) / Math.max(1, width) * drag.current.length, drag.current.length, duration))
        }}
        onPointerUp={(event) => { if (drag.current?.pointer === event.pointerId) { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId) } }}
        onLostPointerCapture={() => { drag.current = null }}
        onPointerCancel={() => { drag.current = null }}
        onKeyDown={(event) => {
          if (event.key === ' ' || event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') {
            event.preventDefault()
            if (event.key === ' ') void onToggle()
            else onSeek(event.key === 'Home' ? 0 : event.key === 'End' ? duration : Math.max(0, Math.min(duration, sourceFrame + (event.key === 'ArrowLeft' ? -1 : 1) * rate)))
          }
        }}>
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-between px-1 text-xs tabular-nums text-text-muted">
          {Array.from({ length: 6 }, (_, index) => <span key={index}>{time(view.start + length * index / 5, rate)}</span>)}
        </div>
        <svg className="pointer-events-none absolute inset-x-0 bottom-2 top-6 h-[calc(100%-2rem)] w-full text-accent" viewBox={`0 0 ${Math.max(1, bars.length)} 100`} preserveAspectRatio="none" aria-hidden="true">
          {barElements}
        </svg>
        {removed.filter((range) => range.end > view.start && range.start < view.end).map((range) => (
          <div key={range.start} data-audio-deleted className="pointer-events-none absolute inset-y-5 border-x border-red-400 bg-red-500/25" style={{ left: `${position(Math.max(view.start, range.start))}%`, width: `${(Math.min(view.end, range.end) - Math.max(view.start, range.start)) / length * 100}%` }} />
        ))}
        {sourceFrame >= view.start && sourceFrame <= view.end && <div className="pointer-events-none absolute inset-y-0 w-px bg-text-dark" style={{ left: `${Math.min(99.95, position(sourceFrame))}%` }} />}
        {!peaks.length && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-text-muted">正在准备波形…</div>}
      </div>
      <div className={`mt-1 flex justify-between gap-3 ${UI_TEXT_META_CLASS}`}><span>点击定位 · 中键拖动平移 · Ctrl + 滚轮缩放 · 空格播放 / 暂停</span><span className="shrink-0 text-red-400">红色区域已删除，播放时跳过</span></div>
    </div>
  )
})
