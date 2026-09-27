import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, Trash2, VolumeX, RotateCcw } from 'lucide-react'
import { createPortal } from 'react-dom'
import ContextMenu from '@/components/ContextMenu'
import { useContextMenu } from '@/hooks/useContextMenu'
import { ICON_SETTINGS as SettingsIcon } from '@/core/theme/icons'
import { UiButton, UiIconButton, UiRangeInput, UiSwitch, UI_TEXT_META_CLASS } from '@/components/ui'
import { buildProjectAudioEditTimeline, editedDurationFrames } from '@/core/audioEdit/timeline'
import { compileAudioEditXmlTimeline } from '@/core/audioEdit/xml'
import type { AudioEditProjectDocument, AudioEditRange } from '@/core/audioEdit/types'
import { useAudioEditPlaybackStore } from './store/audioEditPlaybackStore'
import { clampViewport, sampleWaveform, waveformReference, zoomViewport } from './waveformViewport'

function time(frame: number, rate: number) {
  const seconds = Math.max(0, frame / rate)
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`
}

export const AudioEditTimeline = memo(function AudioEditTimeline({ project, peaks, onSeek, onToggle, selection, onSelection, onEditSelection, previewRanges, previewPending, previewError, disabled, onSettings }: {
  project: AudioEditProjectDocument
  peaks: number[]
  onSeek: (frame: number) => void
  onToggle: () => Promise<void>
  selection: AudioEditRange | null
  onSelection: (range: AudioEditRange | null) => void
  onEditSelection: (mode: 'delete' | 'mute' | 'restore') => void
  previewRanges: AudioEditRange[]
  previewPending: boolean
  previewError?: string
  disabled: boolean
  onSettings: () => void
}) {
  const { durationFrames: duration, sampleRate: rate } = project.source
  const sourceFrame = useAudioEditPlaybackStore((state) => state.sourceFrame)
  const outputFrame = useAudioEditPlaybackStore((state) => state.outputFrame)
  const playing = useAudioEditPlaybackStore((state) => state.playing)
  const preparing = useAudioEditPlaybackStore((state) => state.preparing)
  const ready = useAudioEditPlaybackStore((state) => state.ready)
  const error = useAudioEditPlaybackStore((state) => state.error)
  const autoGain = useAudioEditPlaybackStore((state) => state.autoGain)
  const volume = useAudioEditPlaybackStore((state) => state.volume)
  const mode = useAudioEditPlaybackStore((state) => state.mode)
  const setMode = useAudioEditPlaybackStore((state) => state.setMode)
  const setAutoGain = useAudioEditPlaybackStore((state) => state.setAutoGain)
  const setVolume = useAudioEditPlaybackStore((state) => state.setVolume)
  const [view, setView] = useState({ start: 0, end: duration })
  const [width, setWidth] = useState(800)
  const container = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointer: number; x: number; start: number; length: number; anchor: number; kind: 'pan' | 'select'; moved: boolean } | null>(null)
  const menu = useContextMenu()
  const followAfter = useRef(0)
  const spans = useMemo(() => buildProjectAudioEditTimeline(project), [project])
  const delivery = useMemo(() => {
    try { return { timeline: compileAudioEditXmlTimeline(project), error: '' } }
    catch (error) { return { timeline: null, error: error instanceof Error ? error.message : '无法交付 XML' } }
  }, [project])
  const playDuration = mode === 'source' ? duration : mode === 'delivery' ? editedDurationFrames(delivery.timeline?.spans ?? []) : editedDurationFrames(spans)
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
  const frameAt = (clientX: number, element: HTMLDivElement) => {
    const rect = element.getBoundingClientRect()
    return Math.max(0, Math.min(duration, Math.round(view.start + Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * length)))
  }
  const captions = useMemo(() => {
    const groups: Array<{ startFrame: number; endFrame: number; text: string }> = []
    for (const block of project.transcript) {
      if (block.endFrame <= view.start || block.startFrame >= view.end) continue
      const previous = groups.at(-1)
      if (previous && (previous.endFrame - previous.startFrame) / length * width < 90 && !/[。！？!?]$/.test(previous.text)) {
        previous.endFrame = block.endFrame; previous.text += block.text
      } else groups.push({ startFrame: block.startFrame, endFrame: block.endFrame, text: block.text })
    }
    return groups
  }, [project.transcript, view, length, width])
  const showCaptions = project.viewSettings?.timelineCaptions ?? true
  const pauseFollow = () => { followAfter.current = Date.now() + 3000 }

  useEffect(() => { setView({ start: 0, end: duration }) }, [duration, project.id])
  useEffect(() => {
    const element = container.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      followAfter.current = Date.now() + 3000
      const rect = element.getBoundingClientRect()
      const zooming = event.ctrlKey || event.altKey
      const movement = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      const delta = movement * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (zooming ? rect.height : rect.width) : 1)
      setView((current) => zooming
        ? zoomViewport(current, (event.clientX - rect.left) / Math.max(1, rect.width), Math.exp(Math.max(-1, Math.min(1, delta * 0.002))), duration, rate * 2)
        : clampViewport(current.start + delta / Math.max(1, rect.width) * (current.end - current.start), current.end - current.start, duration))
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
        <UiIconButton appearance="hover-only" showBorder={false} className="h-9 w-9" disabled={!ready || playDuration === 0} onClick={() => void onToggle()} title={playing ? '暂停' : '播放'}>{playing ? <Pause size={16} /> : <Play size={16} />}</UiIconButton>
        <span className="text-sm tabular-nums text-text-dark" data-audio-edit-time>{time(outputFrame, rate)} / {time(playDuration, rate)}</span>
        {(['source', 'edited', 'delivery'] as const).map((value) => <UiButton key={value} variant="plain" aria-pressed={mode === value} className={mode === value ? 'underline underline-offset-4' : ''} size="sm" disabled={value === 'delivery' && !delivery.timeline} title={value === 'delivery' ? delivery.error || '按 XML 帧网格试听原声，关闭声音处理和自动增益' : undefined} onClick={() => setMode(value)}>{value === 'source' ? '原始' : value === 'edited' ? '剪后' : 'XML 交付'}</UiButton>)}
        <span className={UI_TEXT_META_CLASS}>素材 {time(sourceFrame, rate)}</span>
        {preparing && <span className={UI_TEXT_META_CLASS}>正在准备预览…</span>}
        {error && <span className="text-sm text-red-400">{error}</span>}
        <label className={`ml-auto flex shrink-0 items-center gap-2 whitespace-nowrap ${UI_TEXT_META_CLASS}`} title="自动放大小声录音，仅影响试听，不改变导出音量">
          <UiSwitch checked={mode !== 'delivery' && autoGain} disabled={mode === 'delivery'} onCheckedChange={setAutoGain} aria-label="试听自动增益" />自动增益
        </label>
        <label className={`flex shrink-0 items-center gap-2 whitespace-nowrap ${UI_TEXT_META_CLASS}`}>
          试听音量
          <UiRangeInput className="!w-24 shrink-0" aria-label="试听音量" min={0} max={100} step={1} value={Math.round(volume * 100)} onChange={(event) => setVolume(Number(event.target.value) / 100)} />
          <span className="w-9 tabular-nums">{Math.round(volume * 100)}%</span>
        </label>
        <UiButton variant="plain" size="sm" onClick={() => { pauseFollow(); setView({ start: 0, end: duration }) }}>显示全部</UiButton>
      </div>
      {selection && <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-text-muted" aria-label="波形选区操作">
        <span>选区 {time(selection.startFrame, rate)} – {time(selection.endFrame, rate)}</span>
        <UiButton variant="plain" size="sm" disabled={disabled} onClick={() => onEditSelection('delete')}>删除 · Delete</UiButton>
        <UiButton variant="plain" size="sm" disabled={disabled} onClick={() => onEditSelection('mute')}>静音 · M</UiButton>
        <UiButton variant="plain" size="sm" disabled={disabled} onClick={() => onEditSelection('restore')}>恢复选区</UiButton>
        <UiButton variant="plain" size="sm" onClick={() => onSelection(null)}>取消选区</UiButton>
      </div>}
      <div ref={container} role="slider" tabIndex={0} aria-label="口播波形定位" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={sourceFrame} aria-valuetext={time(sourceFrame, rate)}
        data-view-start={view.start} data-view-end={view.end}
        className="relative h-[clamp(8rem,18vh,14rem)] touch-none select-none overflow-hidden bg-bg-dark outline-none focus-visible:ring-1 focus-visible:ring-accent"
        onAuxClick={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (event.button !== 0 && event.button !== 1) return
          event.preventDefault()
          event.currentTarget.focus()
          pauseFollow()
          drag.current = { pointer: event.pointerId, x: event.clientX, start: view.start, length, anchor: frameAt(event.clientX, event.currentTarget), kind: event.button === 1 ? 'pan' : 'select', moved: false }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (!drag.current || drag.current.pointer !== event.pointerId) return
          pauseFollow()
          if (Math.abs(event.clientX - drag.current.x) > 3) drag.current.moved = true
          if (drag.current.kind === 'pan') setView(clampViewport(drag.current.start - (event.clientX - drag.current.x) / Math.max(1, width) * drag.current.length, drag.current.length, duration))
          else if (drag.current.moved) {
            const target = frameAt(event.clientX, event.currentTarget)
            onSelection(target === drag.current.anchor ? null : { startFrame: Math.min(target, drag.current.anchor), endFrame: Math.max(target, drag.current.anchor) })
          }
        }}
        onPointerUp={(event) => { if (drag.current?.pointer === event.pointerId) {
          if (drag.current.kind === 'select' && !drag.current.moved) { onSelection(null); onSeek(drag.current.anchor) }
          drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId)
        } }}
        onLostPointerCapture={() => { drag.current = null }}
        onPointerCancel={() => { drag.current = null }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { onSelection(null); menu.hideMenu(); return }
          if (selection && !disabled && (event.key === 'Delete' || event.key.toLowerCase() === 'm') && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault(); onEditSelection(event.key === 'Delete' ? 'delete' : 'mute'); return
          }
          if (event.key === ' ' || event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') {
            event.preventDefault()
            if (event.key === ' ') void onToggle()
            else onSeek(event.key === 'Home' ? 0 : event.key === 'End' ? duration : Math.max(0, Math.min(duration, sourceFrame + (event.key === 'ArrowLeft' ? -1 : 1) * rate)))
          }
        }}
        onContextMenu={(event) => menu.showMenu(event, [
          { id: 'delete', label: '删除选区 · Delete', icon: <Trash2 size={16} />, disabled: !selection || disabled, onClick: () => onEditSelection('delete') },
          { id: 'mute', label: '静音选区 · M', icon: <VolumeX size={16} />, disabled: !selection || disabled, onClick: () => onEditSelection('mute') },
          { id: 'restore', label: '恢复选区', icon: <RotateCcw size={16} />, disabled: !selection || disabled, onClick: () => onEditSelection('restore') },
        ])}>
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-between px-1 text-xs tabular-nums text-text-muted">
          {Array.from({ length: 6 }, (_, index) => <span key={index}>{time(view.start + length * index / 5, rate)}</span>)}
        </div>
        {showCaptions && <div className="pointer-events-none absolute inset-x-0 top-6 h-7 overflow-hidden" data-audio-captions>{captions.map((block) => <div key={block.startFrame} title={block.text} className="absolute h-7 truncate border-l border-border-dark bg-layer/40 px-1 text-sm leading-7 text-text-dark" style={{ left: `${position(Math.max(view.start, block.startFrame))}%`, width: `${(Math.min(view.end, block.endFrame) - Math.max(view.start, block.startFrame)) / length * 100}%` }}>{block.text}</div>)}</div>}
        <svg className={`pointer-events-none absolute inset-x-0 bottom-2 w-full text-accent ${showCaptions ? 'top-14 h-[calc(100%-4rem)]' : 'top-6 h-[calc(100%-2rem)]'}`} viewBox={`0 0 ${Math.max(1, bars.length)} 100`} preserveAspectRatio="none" aria-hidden="true">
          {barElements}
        </svg>
        {removed.filter((range) => range.end > view.start && range.start < view.end).map((range) => (
          <div key={range.start} data-audio-deleted className="pointer-events-none absolute inset-y-5 border-x border-red-400 bg-red-500/25" style={{ left: `${position(Math.max(view.start, range.start))}%`, width: `${(Math.min(view.end, range.end) - Math.max(view.start, range.start)) / length * 100}%` }} />
        ))}
        {[...spans.filter((span) => span.muted).map((span) => ({ startFrame: span.sourceStartFrame, endFrame: span.sourceEndFrame, kind: 'mute' })), ...previewRanges.map((range) => ({ ...range, kind: 'preview' })), ...(selection ? [{ ...selection, kind: 'selection' }] : [])].filter((range) => range.endFrame > view.start && range.startFrame < view.end).map((range, index) => <div key={`${range.kind}:${index}`} data-audio-overlay={range.kind} className={`pointer-events-none absolute inset-y-5 border-x ${range.kind === 'preview' ? 'border-warning bg-warning/20' : range.kind === 'mute' ? 'border-text-muted bg-text-muted/20' : 'border-accent bg-accent/25'}`} style={{ left: `${position(Math.max(view.start, range.startFrame))}%`, width: `${(Math.min(view.end, range.endFrame) - Math.max(view.start, range.startFrame)) / length * 100}%` }} />)}
        {sourceFrame >= view.start && sourceFrame <= view.end && <div className="pointer-events-none absolute inset-y-0 w-px bg-text-dark" style={{ left: `${Math.min(99.95, position(sourceFrame))}%` }} />}
        {!peaks.length && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-text-muted">正在准备波形…</div>}
      </div>
      <div className={`mt-1 flex flex-wrap items-center justify-between gap-3 ${UI_TEXT_META_CLASS}`}>
        <span>拖动选区 · Delete 删除 · M 静音 · 右键更多 · 滚轮或中键平移 · Ctrl / Alt + 滚轮缩放</span>
        <span aria-live="polite">{previewError || (previewPending ? '正在更新停顿预览…' : '黄色：待处理 · 红色：已删除 · 灰色：已静音')}</span>
        <UiIconButton appearance="hover-only" showBorder={false} title="界面设置" onClick={onSettings}><SettingsIcon size={16} /></UiIconButton>
      </div>
      {createPortal(<ContextMenu visible={menu.menuVisible} position={menu.menuPosition} items={menu.menuItems} onClose={menu.hideMenu} />, document.body)}
    </div>
  )
})
