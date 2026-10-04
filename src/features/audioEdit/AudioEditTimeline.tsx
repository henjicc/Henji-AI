import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Expand, Keyboard, Minus, MoreHorizontal, Pause, Play, Plus, RotateCcw, Trash2, Volume2, VolumeX } from 'lucide-react'
import ContextMenu from '@/components/ContextMenu'
import { useContextMenu } from '@/hooks/useContextMenu'
import { ICON_SETTINGS as SettingsIcon } from '@/core/theme/icons'
import { PanelTrigger, UiButton, UiIconButton, UiLoading, UiOptionButton, UiOverflowRow, UiRangeInput, UiSwitch, UiTextToken, UI_SEGMENTED_TRACK_CLASS, type UiOverflowRowItem } from '@/components/ui'
import { buildProjectAudioEditTimeline, editedDurationFrames } from '@/core/audioEdit/timeline'
import type { AudioEditXmlTimeline } from '@/core/audioEdit/xml'
import type { AudioEditProjectDocument, AudioEditRange } from '@/core/audioEdit/types'
import { useAudioEditPlaybackStore } from './store/audioEditPlaybackStore'
import { AUDIO_EDIT_MIN_VIEW_FRAMES, clampViewport, zoomViewport } from './waveformViewport'
import { WaveformView } from '@/components/waveform/WaveformView'
import { useWaveformData } from '@/hooks/useWaveformData'
import { AudioEditOverview } from './AudioEditOverview'
import { AudioEditMatchedText } from './AudioEditTextTools'
import { buildAudioEditCaptionGroups } from '@/core/audioEdit/captions'
import type { AudioEditTextSearch } from './useAudioEditTextSearch'

function time(frame: number, rate: number) {
  const seconds = Math.max(0, frame / rate)
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`
}

/** 精确读数（设计稿 00:03.240）：分:秒.毫秒，等宽数字。 */
function preciseTime(frame: number, rate: number) {
  const seconds = Math.max(0, frame / rate)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${(seconds % 60).toFixed(3).padStart(6, '0')}`
}

/** 放大条显示播放头附近的窗口（秒）：足够看清单个采样的起伏。 */
const DETAIL_WINDOW_SECONDS = 0.03
const ZOOM_STEPS = 100

export interface AudioEditDelivery { timeline: AudioEditXmlTimeline | null; error: string }

/** 命令带中间的“原始 / 剪后 / XML 交付”试听切换（设计稿把视图切换放在命令带正中）。 */
export function AudioEditPlaybackModeSwitch({ delivery }: { delivery: AudioEditDelivery }) {
  const mode = useAudioEditPlaybackStore((state) => state.mode)
  const setMode = useAudioEditPlaybackStore((state) => state.setMode)
  return <div role="group" aria-label="试听" className={`shrink-0 ${UI_SEGMENTED_TRACK_CLASS}`}>
    {(['source', 'edited', 'delivery'] as const).map((value) => <UiOptionButton key={value} variant="segment" active={mode === value} aria-pressed={mode === value} disabled={value === 'delivery' && !delivery.timeline} aria-label={value === 'delivery' ? 'XML 交付' : undefined} title={value === 'delivery' ? delivery.error || 'XML 交付：按 XML 帧网格试听原声，关闭声音处理和自动增益' : undefined} onClick={() => setMode(value)}>{value === 'source' ? '原始' : value === 'edited' ? '剪后' : 'XML'}</UiOptionButton>)}
  </div>
}

const SHORTCUTS: Array<[string, string]> = [
  ['空格', '播放 / 暂停'],
  ['← / →', '前后移动 1 秒'],
  ['拖动', '选择一段声音'],
  ['Delete', '删除选区'],
  ['M', '静音选区'],
  ['右键', '更多操作'],
  ['滚轮 / 中键拖动', '平移波形'],
  ['Ctrl / Alt + 滚轮', '缩放波形'],
  ['Ctrl + F', '查找与替换'],
  ['Ctrl + Z', '撤销'],
]

const LEGEND: Array<[string, string]> = [
  ['bg-warning-tint', '待处理'],
  ['bg-danger-tint', '已删除'],
  ['bg-text3/30', '已静音'],
]

export const AudioEditTimeline = memo(function AudioEditTimeline({ project, delivery, onSeek, onToggle, selection, onSelection, onEditSelection, previewRanges, previewPending, previewError, disabled, onSettings, selectedBlockIds, onSelectBlock, onEditBlock, onDeleteBlock, navigationTarget, textSearch }: {
  project: AudioEditProjectDocument
  delivery: AudioEditDelivery
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
  selectedBlockIds: string[]
  onSelectBlock: (id: string) => void
  onEditBlock: (id: string) => void
  onDeleteBlock: (id: string) => void
  navigationTarget: { frame: number } | null
  textSearch: AudioEditTextSearch
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
  const setAutoGain = useAudioEditPlaybackStore((state) => state.setAutoGain)
  const setVolume = useAudioEditPlaybackStore((state) => state.setVolume)
  const [view, setView] = useState({ start: 0, end: duration })
  const [width, setWidth] = useState(800)
  const container = useRef<HTMLDivElement>(null)
  const wheelRegion = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointer: number; x: number; start: number; length: number; anchor: number; kind: 'pan' | 'select'; moved: boolean } | null>(null)
  const menu = useContextMenu()
  const followAfter = useRef(0)
  const spans = useMemo(() => buildProjectAudioEditTimeline(project), [project])
  const editedDuration = useMemo(() => editedDurationFrames(spans), [spans])
  const playDuration = mode === 'source' ? duration : mode === 'delivery' ? editedDurationFrames(delivery.timeline?.spans ?? []) : editedDuration
  const removedFrames = Math.max(0, duration - editedDuration)
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
  const waveform = useWaveformData(project.source.audioPath ? { source: project.source.audioPath, channels: 1 } : null, 'full')
  const cutRanges = useMemo(() => removed.map((range) => ({ start: range.start / rate, end: range.end / rate })), [removed, rate])
  const length = Math.max(1, view.end - view.start)
  const position = (frame: number) => (frame - view.start) / length * 100
  const frameAt = (clientX: number, element: HTMLDivElement) => {
    const rect = element.getBoundingClientRect()
    return Math.max(0, Math.min(duration, Math.round(view.start + Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * length)))
  }
  const captions = useMemo(() => {
    const groups = project.transcript.some((block) => block.captionBreakAfter !== undefined)
      ? buildAudioEditCaptionGroups(project.transcript, rate)
      : project.transcript.map((block) => ({ id: block.id, startFrame: block.startFrame, endFrame: block.endFrame, blocks: [block] }))
    return groups.filter((group) => group.endFrame > view.start && group.startFrame < view.end)
  }, [project.transcript, rate, view])
  const showCaptions = project.viewSettings?.timelineCaptions ?? true
  const pauseFollow = () => { followAfter.current = Date.now() + 3000 }
  // 缩放条：0 = 整段，ZOOM_STEPS = 最细（按采样定位），按对数均匀分布
  const minimumView = Math.min(duration, AUDIO_EDIT_MIN_VIEW_FRAMES)
  const zoomRange = Math.log(Math.max(1, duration) / Math.max(1, minimumView))
  const zoomLevel = zoomRange > 0 ? Math.round(Math.log(Math.max(1, duration) / length) / zoomRange * ZOOM_STEPS) : 0
  const zoomTo = (level: number) => {
    pauseFollow()
    const target = Math.max(minimumView, duration / Math.exp(Math.max(0, Math.min(ZOOM_STEPS, level)) / ZOOM_STEPS * zoomRange))
    setView((current) => {
      const currentLength = Math.max(1, current.end - current.start)
      const anchor = sourceFrame >= current.start && sourceFrame <= current.end ? (sourceFrame - current.start) / currentLength : 0.5
      return zoomViewport(current, anchor, target / currentLength, duration, minimumView)
    })
  }
  const detailStart = Math.max(0, sourceFrame / rate - DETAIL_WINDOW_SECONDS / 2)
  const detailEnd = Math.min(duration / rate, detailStart + DETAIL_WINDOW_SECONDS)

  useEffect(() => { setView({ start: 0, end: duration }) }, [duration, project.id])
  useEffect(() => {
    if (!navigationTarget) return
    followAfter.current = Date.now() + 3000
    setView((current) => navigationTarget.frame < current.start || navigationTarget.frame >= current.end
      ? clampViewport(navigationTarget.frame - (current.end - current.start) * 0.2, current.end - current.start, duration) : current)
  }, [navigationTarget, duration])
  useEffect(() => {
    const element = container.current
    const region = wheelRegion.current
    if (!element || !region) return
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
        ? zoomViewport(current, (event.clientX - rect.left) / Math.max(1, rect.width), Math.exp(Math.max(-1, Math.min(1, delta * 0.002))), duration, AUDIO_EDIT_MIN_VIEW_FRAMES)
        : clampViewport(current.start + delta / Math.max(1, rect.width) * (current.end - current.start), current.end - current.start, duration))
    }
    region.addEventListener('wheel', wheel, { passive: false })
    return () => { observer.disconnect(); region.removeEventListener('wheel', wheel) }
  }, [duration, rate])
  useEffect(() => {
    if (!playing || drag.current || Date.now() < followAfter.current) return
    if (sourceFrame < view.start || sourceFrame >= view.end) setView(clampViewport(sourceFrame - length * 0.15, length, duration))
  }, [duration, length, playing, sourceFrame, view])

  const statusText = previewError || (previewPending ? '正在更新停顿预览…' : '')
  const readouts = [
    mode !== 'source' && removedFrames > 0 ? `已剪去 ${(removedFrames / rate).toFixed(1)} 秒` : '',
    preparing ? '正在准备预览…' : '',
    statusText,
  ].filter(Boolean)
  // 播放条右侧控件：priority 越小越早收进“更多”；试听错误常驻（pinned，放不下时自身截断）
  const transportItems: UiOverflowRowItem[] = [
    ...(readouts.length ? [{ id: 'readouts', priority: 10, node: <span className="max-w-56 truncate whitespace-nowrap text-xs text-text3" aria-live="polite" title={readouts.join(' · ')}>{readouts.join(' · ')}</span> }] : []),
    ...(error ? [{ id: 'error', priority: 100, pinned: true, node: <span role="alert" className="min-w-0 truncate text-xs text-danger-text" title={error}>{error}</span> }] : []),
    ...(selection ? [{ id: 'selection', priority: 90, node: <div className="flex items-center gap-1" aria-label="波形选区操作">
      <span className="mr-1 whitespace-nowrap font-mono text-xs tabular-nums text-text2">选区 {time(selection.startFrame, rate)} – {time(selection.endFrame, rate)}</span>
      <UiButton size="sm" variant="danger" disabled={disabled} title="删除选区 · Delete" onClick={() => onEditSelection('delete')}><Trash2 size={14} className="mr-1" />删除</UiButton>
      <UiButton size="sm" disabled={disabled} title="静音选区 · M" onClick={() => onEditSelection('mute')}><VolumeX size={14} className="mr-1" />静音</UiButton>
      <UiButton size="sm" disabled={disabled} onClick={() => onEditSelection('restore')}><RotateCcw size={14} className="mr-1" />恢复选区</UiButton>
      <UiButton size="sm" onClick={() => onSelection(null)}>取消选区</UiButton>
    </div> }] : []),
    { id: 'gain', priority: 40, node: <label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs text-text2" title="自动放大小声录音，仅影响试听，不改变导出音量">
      <UiSwitch checked={mode !== 'delivery' && autoGain} disabled={mode === 'delivery'} onCheckedChange={setAutoGain} aria-label="试听自动增益" />自动增益
    </label> },
    { id: 'volume', priority: 50, node: <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-text2" title={`试听音量 ${Math.round(volume * 100)}%`}>
      <Volume2 size={14} aria-hidden="true" className="text-text3" />
      <UiRangeInput className="!w-20 shrink-0" aria-label="试听音量" min={0} max={100} step={1} value={Math.round(volume * 100)} onChange={(event) => setVolume(Number(event.target.value) / 100)} />
    </label> },
    { id: 'zoom', priority: 60, node: <div className="flex items-center gap-1.5" role="group" aria-label="波形缩放控制">
      <UiIconButton aria-label="显示全部" title="显示全部" onClick={() => { pauseFollow(); setView({ start: 0, end: duration }) }}><Expand size={16} /></UiIconButton>
      <UiIconButton aria-label="缩小波形" title="缩小波形" disabled={zoomLevel <= 0} onClick={() => zoomTo(zoomLevel - 10)}><Minus size={16} /></UiIconButton>
      <UiRangeInput className="!w-24 shrink-0" aria-label="波形缩放" min={0} max={ZOOM_STEPS} step={1} value={Math.max(0, Math.min(ZOOM_STEPS, zoomLevel))} onChange={(event) => zoomTo(Number(event.target.value))} />
      <UiIconButton aria-label="放大波形" title="放大波形" disabled={zoomLevel >= ZOOM_STEPS} onClick={() => zoomTo(zoomLevel + 10)}><Plus size={16} /></UiIconButton>
    </div> },
    { id: 'help', priority: 30, node: <PanelTrigger
      panelWidth={248}
      panelPadding="content"
      renderPanel={() => (
        <div className="flex flex-col gap-3 text-xs">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
            {SHORTCUTS.map(([key, label]) => <div key={key} className="contents"><dt className="font-mono text-text1">{key}</dt><dd className="text-text2">{label}</dd></div>)}
          </dl>
          <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-2.5 text-text2">
            {LEGEND.map(([swatch, label]) => <span key={label} className="flex items-center gap-1.5"><span aria-hidden="true" className={`h-2.5 w-2.5 rounded-sm ${swatch}`} />{label}</span>)}
          </div>
        </div>
      )}
    >
      {({ open, togglePanel }) => <UiIconButton aria-label="快捷键与图例" title="快捷键与图例" on={open} aria-expanded={open} onClick={togglePanel} data-panel-trigger-button><Keyboard size={16} /></UiIconButton>}
    </PanelTrigger> },
    { id: 'settings', priority: 70, node: <UiIconButton title="界面设置" aria-label="界面设置" onClick={onSettings}><SettingsIcon size={16} /></UiIconButton> },
  ]

  return (
    <section ref={wheelRegion} aria-label="波形" data-audio-timeline className="shrink-0 border-t border-gap bg-panel">
      {/* 播放条：放不下时按优先级把右侧控件收进“更多”（UiOverflowRow），任何宽度下都不折行 */}
      <div className="flex min-h-10 items-center gap-1.5 px-2.5 py-1">
        <UiIconButton size="lg" disabled={!ready || playDuration === 0} onClick={() => void onToggle()} title={playing ? '暂停' : '播放'} aria-label={playing ? '暂停' : '播放'}>{playing ? <Pause size={16} /> : <Play size={16} />}</UiIconButton>
        <span className="shrink-0 whitespace-nowrap font-mono text-13 tabular-nums" data-audio-edit-time>
          <span className="text-text1">{preciseTime(outputFrame, rate)}</span><span className="text-text3"> / {preciseTime(playDuration, rate)}</span>
        </span>
        <UiOverflowRow
          className="flex-1 justify-end gap-1.5"
          items={transportItems}
          renderOverflow={(hiddenIds) => (
            <PanelTrigger
              panelWidth={280}
              panelPadding="content"
              renderPanel={() => (
                <div className="flex flex-col items-start gap-3">
                  {transportItems.filter((item) => hiddenIds.includes(item.id)).map((item) => <div key={item.id} className="flex flex-wrap items-center gap-1.5">{item.node}</div>)}
                </div>
              )}
            >
              {({ open, togglePanel }) => <UiIconButton aria-label="更多播放控制" title="更多播放控制" on={open} aria-expanded={open} onClick={togglePanel} data-panel-trigger-button><MoreHorizontal size={16} /></UiIconButton>}
            </PanelTrigger>
          )}
        />
      </div>
      <div className="flex flex-col gap-1.5 px-2.5 pb-2.5">
        <div ref={container} role="slider" tabIndex={0} aria-label="口播波形定位" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={sourceFrame} aria-valuetext={time(sourceFrame, rate)}
          data-view-start={view.start} data-view-end={view.end}
          className="relative h-[clamp(8rem,18vh,14rem)] touch-none select-none overflow-hidden rounded-md bg-gap outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
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
          <div className="pointer-events-none absolute inset-x-0 top-0 flex h-5 items-center justify-between px-1.5 font-mono text-2xs tabular-nums text-text3">
            {Array.from({ length: 6 }, (_, index) => <span key={index}>{time(view.start + length * index / 5, rate)}</span>)}
          </div>
          {showCaptions && <div className="absolute inset-x-1 top-5 h-6 overflow-hidden" data-audio-captions>{captions.map((group) => <div key={group.id} className="absolute flex h-6 gap-0.5 overflow-hidden whitespace-nowrap pr-0.5" style={{ left: `${position(Math.max(view.start, group.startFrame))}%`, width: `${(Math.min(view.end, group.endFrame) - Math.max(view.start, group.startFrame)) / length * 100}%` }}>{group.blocks.map((block) => <UiTextToken appearance="chip" key={block.id} disabled={disabled}
            selected={selectedBlockIds.includes(block.id)} excluded={!block.included}
            title={`${block.text} · 单击选中，双击编辑，右键删除`}
            onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); onSelectBlock(block.id) }} onDoubleClick={(event) => { event.stopPropagation(); onEditBlock(block.id) }}
            onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onSelectBlock(block.id); onDeleteBlock(block.id) }}><span className="block w-full truncate">{block.text ? <AudioEditMatchedText block={block} search={textSearch} /> : '（空字幕）'}</span></UiTextToken>)}</div>)}</div>}
          <div className={`pointer-events-none absolute inset-x-0 bottom-1.5 ${showCaptions ? 'top-12' : 'top-6'}`}>
            <WaveformView waveform={waveform} startSeconds={view.start / rate} endSeconds={view.end / rate} playedSeconds={sourceFrame / rate} cutRanges={cutRanges} />
          </div>
          {removed.filter((range) => range.end > view.start && range.start < view.end).map((range) => (
            <div key={range.start} data-audio-deleted className="pointer-events-none absolute inset-y-5 border-x border-danger-text bg-danger-tint" style={{ left: `${position(Math.max(view.start, range.start))}%`, width: `${(Math.min(view.end, range.end) - Math.max(view.start, range.start)) / length * 100}%` }} />
          ))}
          {[...spans.filter((span) => span.muted).map((span) => ({ startFrame: span.sourceStartFrame, endFrame: span.sourceEndFrame, kind: 'mute' })), ...previewRanges.map((range) => ({ ...range, kind: 'preview' })), ...(selection ? [{ ...selection, kind: 'selection' }] : [])].filter((range) => range.endFrame > view.start && range.startFrame < view.end).map((range, index) => <div key={`${range.kind}:${index}`} data-audio-overlay={range.kind} className={`pointer-events-none absolute inset-y-5 border-x ${range.kind === 'preview' ? 'border-warning-text bg-warning-tint' : range.kind === 'mute' ? 'border-text3 bg-text3/20' : 'border-accent-ring bg-accent-tint'}`} style={{ left: `${position(Math.max(view.start, range.startFrame))}%`, width: `${(Math.min(view.end, range.endFrame) - Math.max(view.start, range.startFrame)) / length * 100}%` }} />)}
          {sourceFrame >= view.start && sourceFrame <= view.end && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-px bg-accent-ring" style={{ left: `${Math.min(99.95, position(sourceFrame))}%` }}><span className="absolute -left-[5px] -top-0.5 h-2.5 w-[11px] rounded-b-md bg-accent-ring" /></div>}
          {!waveform.data && (waveform.status === 'error'
            ? <div role="alert" className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-danger-text">{waveform.error}</div>
            : <UiLoading size="xs" message="正在准备波形…" className="pointer-events-none absolute inset-0" />)}
        </div>
        <AudioEditOverview duration={duration} sampleRate={rate} sourceFrame={sourceFrame} waveform={waveform} view={view} onChange={(next) => { pauseFollow(); setView(next) }} />
        {waveform.data && <div className="grid grid-cols-[96px_minmax(0,1fr)] items-stretch gap-2.5" data-audio-detail>
          <div className="flex flex-col justify-center gap-0.5">
            <span className="text-xs font-medium text-text1">放大</span>
            <span className="font-mono text-2xs tabular-nums text-text3">{preciseTime(detailStart * rate, rate).slice(3)}–{preciseTime(detailEnd * rate, rate).slice(3)}</span>
          </div>
          <div className="relative h-12 overflow-hidden rounded-md bg-gap">
            <WaveformView waveform={waveform} startSeconds={detailStart} endSeconds={detailEnd} playedSeconds={sourceFrame / rate} cutRanges={cutRanges} label="播放头附近的采样级波形" />
            <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-px bg-accent-ring" style={{ left: `${Math.max(0, Math.min(100, (sourceFrame / rate - detailStart) / Math.max(1e-6, detailEnd - detailStart) * 100))}%` }} />
          </div>
        </div>}
      </div>
      <ContextMenu visible={menu.menuVisible} position={menu.menuPosition} items={menu.menuItems} onClose={menu.hideMenu} />
    </section>
  )
})
