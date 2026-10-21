import React from 'react'
import { SpectrogramView } from '@/components/audio/SpectrogramView'
import { UiEmpty, UiError, UiLoading } from '@/components/ui'
import { UI_TEXT_TIMECODE_CLASS } from '@/components/ui/styleTokens'
import { WaveformView } from '@/components/waveform/WaveformView'
import { formatSpectrogramHz, spectrogramNyquist, spectrogramTicks, type SpectrogramData } from '@/core/audio/spectrogram'
import type { WaveformState } from '@/hooks/useWaveformData'
import { AUDIO_EDIT_MIN_VIEW_FRAMES, type WaveformViewport } from '../waveformViewport'
import {
  amplitudeTicks, brushRadius, CLICK_SLOP_PX, formatTimecode, frameAtX, hzAtY, normalizeSpectralSelection, normalizeTimeSelection, panTime, timeTickStep, xAtFrame, yAtHz,
  zoomAmplitude, zoomFrequency, zoomTime,
  type AudioBrushPoint, type AudioBrushStroke, type AudioEditorTool, type AudioSpectralSelection, type AudioTimeSelection, type FrequencyView,
} from './spectralEditorModel'

export type AudioEditorDisplay = 'both' | 'waveform' | 'spectrum'
export interface AudioEditorRegion { id: string; start: number; end: number; lowHz?: number; highHz?: number }

export interface AudioSpectralEditorProps {
  sampleRate: number
  durationFrames: number
  waveform: WaveformState
  spectrogram?: SpectrogramData
  spectrogramStatus: 'idle' | 'loading' | 'ready' | 'error'
  spectrogramError?: string
  onRetrySpectrogram?: () => void
  view: WaveformViewport
  onViewChange: (view: WaveformViewport) => void
  display: AudioEditorDisplay
  tool: AudioEditorTool
  /** 修复画笔的屏幕半径（CSS 像素）。 */
  brushPixels: number
  playheadFrame: number
  onSeek: (frame: number) => void
  selection: AudioTimeSelection | null
  onSelectionChange: (selection: AudioTimeSelection | null) => void
  spectralSelection: AudioSpectralSelection | null
  onSpectralSelectionChange: (selection: AudioSpectralSelection | null) => void
  onBrushStroke: (stroke: AudioBrushStroke) => void
  /** 已删除 / 已静音的区间（源采样帧），在两个视图上叠一层标记。 */
  cutRanges: ReadonlyArray<{ start: number; end: number; mode: 'delete' | 'mute' }>
  /** 已有的修复记录：频谱上画出轮廓，方便找到改过的地方。 */
  repairs: readonly AudioEditorRegion[]
  /** 右键编辑区：宿主弹出针对选区的菜单。 */
  onContextMenu?: (event: React.MouseEvent) => void
}

const RULER_WIDTH = 'w-11'
const DEFAULT_SPLIT = 0.45

type Pane = 'waveform' | 'spectrum'
type Drag =
  | { kind: 'time'; pointer: number; origin: number; x: number; moved: boolean }
  | { kind: 'marquee'; pointer: number; origin: AudioBrushPoint; x: number; y: number; moved: boolean }
  | { kind: 'brush'; pointer: number; points: AudioBrushPoint[] }
  | { kind: 'pan'; pointer: number; x: number; view: WaveformViewport }
  | { kind: 'split'; pointer: number; y: number; top: number; height: number }

function useNonPassiveWheel(ref: React.RefObject<HTMLElement | null>, handler: (event: WheelEvent) => void): void {
  const latest = React.useRef(handler)
  latest.current = handler
  React.useEffect(() => {
    const element = ref.current
    if (!element) return
    const listener = (event: WheelEvent) => latest.current(event)
    element.addEventListener('wheel', listener, { passive: false })
    return () => element.removeEventListener('wheel', listener)
  }, [ref])
}

/**
 * 波形 + 频谱编辑区（参照 Audition 的波形编辑器）：上下两种视图共用一个时间视口，横向缩放永远联动。
 * - 内容区滚轮：以指针为中心缩放时间；Shift + 滚轮平移。
 * - 右侧 dB 刻度上滚轮：波形纵向缩放；Hz 刻度上滚轮：频谱频率范围缩放。
 * - 左键拖动按当前工具：时间选区 / 频谱框选 / 修复画笔 / 平移；单击定位播放头并取消选区。
 * 只负责显示与手势，编辑动作（删除、静音、修复）由宿主根据选区执行。
 */
export function AudioSpectralEditor(props: AudioSpectralEditorProps) {
  const { sampleRate, durationFrames, view, display, tool, selection, spectralSelection, playheadFrame } = props
  const nyquist = props.spectrogram ? spectrogramNyquist(props.spectrogram) : sampleRate / 2
  const [amplitudeZoom, setAmplitudeZoom] = React.useState(1)
  const [frequency, setFrequency] = React.useState<FrequencyView>({ minHz: 20, maxHz: nyquist, scale: 'log' })
  const [split, setSplit] = React.useState(DEFAULT_SPLIT)
  const [livePoints, setLivePoints] = React.useState<AudioBrushPoint[] | null>(null)
  const [hover, setHover] = React.useState<{ x: number; y: number; pane: Pane } | null>(null)
  const drag = React.useRef<Drag | null>(null)
  const content = React.useRef<HTMLDivElement | null>(null)
  const waveRuler = React.useRef<HTMLDivElement | null>(null)
  const spectrumRuler = React.useRef<HTMLDivElement | null>(null)
  const waveformPane = React.useRef<HTMLDivElement | null>(null)
  const spectrumPane = React.useRef<HTMLDivElement | null>(null)
  const channels = props.waveform.data?.pyramid.channelCount ?? props.spectrogram?.channelCount ?? 1
  const lanes = React.useMemo(() => Array.from({ length: channels }, (_, index) => index), [channels])

  React.useEffect(() => { setFrequency(previous => ({ ...previous, maxHz: Math.min(previous.maxHz, nyquist) || nyquist })) }, [nyquist])

  const showWave = display !== 'spectrum'
  const showSpectrum = display !== 'waveform'
  const width = (): number => content.current?.getBoundingClientRect().width ?? 1
  const minimumView = Math.min(durationFrames, AUDIO_EDIT_MIN_VIEW_FRAMES)

  useNonPassiveWheel(content, (event) => {
    if (durationFrames <= 0) return
    event.preventDefault()
    const rect = content.current!.getBoundingClientRect()
    if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      const delta = (event.shiftKey ? event.deltaY : event.deltaX) / Math.max(1, rect.width) * (view.end - view.start)
      props.onViewChange(panTime(view, delta, durationFrames))
      return
    }
    props.onViewChange(zoomTime(view, (event.clientX - rect.left) / Math.max(1, rect.width), event.deltaY, durationFrames, minimumView))
  })
  useNonPassiveWheel(waveRuler, (event) => { event.preventDefault(); setAmplitudeZoom(current => zoomAmplitude(current, event.deltaY)) })
  useNonPassiveWheel(spectrumRuler, (event) => {
    event.preventDefault()
    const rect = spectrumRuler.current!.getBoundingClientRect()
    setFrequency(current => zoomFrequency(current, 1 - (event.clientY - rect.top) / Math.max(1, rect.height), event.deltaY, 0, nyquist))
  })

  const paneAt = (clientY: number): Pane => {
    if (!showSpectrum) return 'waveform'
    if (!showWave) return 'spectrum'
    const rect = spectrumPane.current?.getBoundingClientRect()
    return rect && clientY >= rect.top ? 'spectrum' : 'waveform'
  }
  const spectrumPoint = (clientX: number, clientY: number): AudioBrushPoint => {
    const rect = spectrumPane.current!.getBoundingClientRect()
    const lane = Math.max(1, rect.height / Math.max(1, channels))
    const y = (clientY - rect.top) % lane
    return { frame: frameAtX(clientX - rect.left, rect.width, view), hz: hzAtY(y, lane, frequency) }
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || durationFrames <= 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const pane = paneAt(event.clientY)
    event.currentTarget.setPointerCapture(event.pointerId)
    if (tool === 'hand') { drag.current = { kind: 'pan', pointer: event.pointerId, x: event.clientX, view }; return }
    if (pane === 'spectrum' && tool === 'brush') {
      const point = spectrumPoint(event.clientX, event.clientY)
      drag.current = { kind: 'brush', pointer: event.pointerId, points: [point] }; setLivePoints([point]); return
    }
    if (pane === 'spectrum' && tool === 'marquee') {
      drag.current = { kind: 'marquee', pointer: event.pointerId, origin: spectrumPoint(event.clientX, event.clientY), x: event.clientX, y: event.clientY, moved: false }; return
    }
    drag.current = { kind: 'time', pointer: event.pointerId, origin: frameAtX(x, rect.width, view), x: event.clientX, moved: false }
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setHover({ x: event.clientX - rect.left, y: event.clientY - rect.top, pane: paneAt(event.clientY) })
    const current = drag.current
    if (!current || current.pointer !== event.pointerId) return
    if (current.kind === 'pan') { props.onViewChange(panTime(current.view, -(event.clientX - current.x) / Math.max(1, rect.width) * (current.view.end - current.view.start), durationFrames)); return }
    if (current.kind === 'brush') { current.points.push(spectrumPoint(event.clientX, event.clientY)); setLivePoints([...current.points]); return }
    if (current.kind === 'marquee') {
      current.moved ||= Math.hypot(event.clientX - current.x, event.clientY - current.y) > CLICK_SLOP_PX
      if (current.moved) props.onSpectralSelectionChange(normalizeSpectralSelection(current.origin, spectrumPoint(event.clientX, event.clientY), durationFrames, nyquist))
      return
    }
    if (current.kind === 'time') {
      current.moved ||= Math.abs(event.clientX - current.x) > CLICK_SLOP_PX
      if (current.moved) props.onSelectionChange(normalizeTimeSelection(current.origin, frameAtX(event.clientX - rect.left, rect.width, view), durationFrames))
    }
  }
  const finish = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || current.pointer !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const rect = event.currentTarget.getBoundingClientRect()
    if (current.kind === 'brush') {
      setLivePoints(null)
      const pane = spectrumPane.current!.getBoundingClientRect()
      props.onBrushStroke({ points: current.points, ...brushRadius(props.brushPixels, pane.width, pane.height / Math.max(1, channels), view, frequency) })
      return
    }
    if ((current.kind === 'time' || current.kind === 'marquee') && !current.moved) {
      props.onSeek(Math.round(frameAtX(event.clientX - rect.left, rect.width, view)))
      props.onSelectionChange(null); props.onSpectralSelectionChange(null)
      return
    }
    if (current.kind === 'time') props.onSpectralSelectionChange(null)
  }

  const onSplitDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const rect = content.current!.getBoundingClientRect()
    drag.current = { kind: 'split', pointer: event.pointerId, y: event.clientY, top: rect.top, height: rect.height }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.stopPropagation()
  }
  const onSplitMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (current?.kind !== 'split' || current.pointer !== event.pointerId) return
    setSplit(Math.max(0.15, Math.min(0.85, (event.clientY - current.top) / Math.max(1, current.height))))
  }
  const onSplitUp = (event: React.PointerEvent<HTMLDivElement>) => { if (drag.current?.kind === 'split') { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId) } }

  const percentX = (frame: number) => `${xAtFrame(frame, 100, view)}%`
  const spanStyle = (start: number, end: number): React.CSSProperties => ({ left: percentX(Math.max(view.start, start)), width: `${Math.max(0, xAtFrame(Math.min(view.end, end), 100, view) - xAtFrame(Math.max(view.start, start), 100, view))}%` })
  const visible = (start: number, end: number) => end > view.start && start < view.end
  const cursor = tool === 'hand' ? 'cursor-grab' : tool === 'brush' && hover?.pane === 'spectrum' ? 'cursor-none' : tool === 'marquee' && hover?.pane === 'spectrum' ? 'cursor-crosshair' : 'cursor-text'
  const step = timeTickStep(view, width(), sampleRate)
  const ticks: number[] = []
  for (let frame = Math.ceil(view.start / step) * step; frame <= view.end && ticks.length < 200; frame += step) ticks.push(frame)
  const waveTicks = amplitudeTicks(amplitudeZoom)
  const hzTicks = spectrogramTicks(frequency.minHz, frequency.maxHz, frequency.scale)
  const laneFraction = 100 / Math.max(1, channels)

  const spectrumBody = props.spectrogramStatus === 'error'
    ? <UiError message={props.spectrogramError ?? '频谱图没有生成出来。'} {...(props.onRetrySpectrogram ? { onRetry: props.onRetrySpectrogram } : {})} />
    : props.spectrogramStatus === 'loading' && !props.spectrogram ? <UiLoading message="正在生成频谱图…" />
      : <SpectrogramView data={props.spectrogram} lanes={lanes} startFrame={view.start} endFrame={view.end} minHz={frequency.minHz} maxHz={frequency.maxHz} scale={frequency.scale} label="频谱图" />

  return <div className="grid h-full min-h-0 select-none grid-cols-[minmax(0,1fr)_auto] grid-rows-[24px_minmax(0,1fr)] bg-gap" data-audio-spectral-editor data-tool={tool} data-display={display} data-spectrogram-status={props.spectrogramStatus}>
    {/* 时间刻度 */}
    <div className="relative overflow-hidden border-b border-line" aria-hidden>
      {ticks.map(frame => <div key={frame} className="absolute inset-y-0 flex items-end" style={{ left: percentX(frame) }}>
        <span className="h-2 w-px bg-line-strong" />
        <span className={`${UI_TEXT_TIMECODE_CLASS} absolute bottom-1.5 left-1 whitespace-nowrap text-2xs text-text3`}>{formatTimecode(frame, sampleRate, step)}</span>
      </div>)}
      {selection && visible(selection.start, selection.end) && <div className="absolute inset-y-0 bg-accent-tint" style={spanStyle(selection.start, selection.end)} />}
      <div className="absolute inset-y-0 w-px bg-accent" style={{ left: percentX(playheadFrame) }} />
    </div>
    <div className={`${RULER_WIDTH} border-b border-l border-line`} aria-hidden />

    {/* 内容区：波形在上、频谱在下，共用时间视口 */}
    <div ref={content} className={`relative flex min-h-0 touch-none flex-col overflow-hidden ${cursor}`} role="application" aria-label="音频波形与频谱编辑区"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { drag.current = null; setLivePoints(null) }}
      onPointerLeave={() => setHover(null)} onContextMenu={props.onContextMenu}>
      {showWave && <div ref={waveformPane} className="relative min-h-0" style={{ height: showSpectrum ? `${split * 100}%` : '100%' }}>
        {props.waveform.data
          ? <WaveformView waveform={props.waveform} startSeconds={view.start / sampleRate} endSeconds={view.end / sampleRate} lanes={lanes} gain={amplitudeZoom} label="音频波形" />
          : props.waveform.status === 'error' ? <UiError message={props.waveform.error ?? '波形没有读出来。'} /> : <UiLoading message="正在读取波形…" />}
        {lanes.slice(1).map(lane => <div key={lane} className="pointer-events-none absolute inset-x-0 h-px bg-line" style={{ top: `${lane * laneFraction}%` }} />)}
      </div>}
      {showWave && showSpectrum && <div className="relative h-1.5 shrink-0 cursor-row-resize bg-window hover:bg-hover" role="separator" aria-orientation="horizontal" aria-label="调整波形与频谱的高度"
        onPointerDown={onSplitDown} onPointerMove={onSplitMove} onPointerUp={onSplitUp} />}
      {showSpectrum && <div ref={spectrumPane} className="relative min-h-0 flex-1">
        {spectrumBody}
        {lanes.slice(1).map(lane => <div key={lane} className="pointer-events-none absolute inset-x-0 h-px bg-gap" style={{ top: `${lane * laneFraction}%` }} />)}
        {/* 修复记录与框选只在频谱上有频率维度 */}
        {lanes.map(lane => <React.Fragment key={lane}>
          {props.repairs.filter(region => visible(region.start, region.end) && region.lowHz !== undefined).map(region => <div key={region.id} className="pointer-events-none absolute border border-dashed border-on-media/70"
            style={{ ...spanStyle(region.start, region.end), top: `${lane * laneFraction + yAtHz(region.highHz!, laneFraction, frequency)}%`, height: `${yAtHz(region.lowHz!, laneFraction, frequency) - yAtHz(region.highHz!, laneFraction, frequency)}%` }} />)}
          {spectralSelection && visible(spectralSelection.start, spectralSelection.end) && <div className="pointer-events-none absolute border border-accent-ring bg-accent-tint"
            style={{ ...spanStyle(spectralSelection.start, spectralSelection.end), top: `${lane * laneFraction + yAtHz(spectralSelection.highHz, laneFraction, frequency)}%`, height: `${yAtHz(spectralSelection.lowHz, laneFraction, frequency) - yAtHz(spectralSelection.highHz, laneFraction, frequency)}%` }} />}
        </React.Fragment>)}
        {livePoints && <BrushTrail points={livePoints} radius={props.brushPixels} view={view} frequency={frequency} lanes={channels} />}
        {tool === 'brush' && hover?.pane === 'spectrum' && !livePoints && spectrumPane.current && <div className="pointer-events-none absolute rounded-full border border-on-media"
          style={{ left: hover.x - props.brushPixels, top: hover.y - (spectrumPane.current.offsetTop) - props.brushPixels, width: props.brushPixels * 2, height: props.brushPixels * 2 }} />}
      </div>}
      {/* 跨两种视图的标记：删除/静音、时间选区、播放头 */}
      {props.cutRanges.filter(range => visible(range.start, range.end)).map(range => <div key={`${range.start}-${range.end}`} className={`pointer-events-none absolute inset-y-0 ${range.mode === 'delete' ? 'bg-danger-tint' : 'bg-scrim-soft'}`} style={spanStyle(range.start, range.end)} />)}
      {selection && visible(selection.start, selection.end) && <div className="pointer-events-none absolute inset-y-0 border-x border-accent-ring bg-accent-tint" style={spanStyle(selection.start, selection.end)} />}
      <div className="pointer-events-none absolute inset-y-0 w-px bg-accent" style={{ left: percentX(playheadFrame) }} />
    </div>

    {/* 右侧刻度：dB 在波形旁、Hz 在频谱旁；在刻度上滚轮做纵向缩放 */}
    <div className={`${RULER_WIDTH} flex min-h-0 flex-col border-l border-line`}>
      {showWave && <div ref={waveRuler} className="relative min-h-0 cursor-ns-resize" style={{ height: showSpectrum ? `${split * 100}%` : '100%' }} aria-label="振幅刻度，滚动缩放波形高度" data-ruler="amplitude">
        {lanes.map(lane => waveTicks.flatMap(tick => [1, -1].map(sign => {
          const mid = (lane + 0.5) * laneFraction
          const top = mid - sign * tick.amplitude * laneFraction / 2
          return <span key={`${lane}:${tick.db}:${sign}`} className={`${UI_TEXT_TIMECODE_CLASS} absolute left-1 -translate-y-1/2 text-2xs text-text3`} style={{ top: `${top}%` }}>{tick.db === 0 ? '0' : tick.db}</span>
        })))}
      </div>}
      {showWave && showSpectrum && <div className="h-1.5 shrink-0" />}
      {showSpectrum && <div ref={spectrumRuler} className="relative min-h-0 flex-1 cursor-ns-resize" aria-label="频率刻度，滚动缩放频率范围" data-ruler="frequency">
        {lanes.map(lane => hzTicks.filter(hz => { const at = yAtHz(hz, 100, frequency); return at > 6 && at < 94 }).map(hz => <span key={`${lane}:${hz}`} className={`${UI_TEXT_TIMECODE_CLASS} absolute left-1 -translate-y-1/2 text-2xs text-text3`}
          style={{ top: `${lane * laneFraction + yAtHz(hz, laneFraction, frequency)}%` }}>{formatSpectrogramHz(hz)}</span>))}
      </div>}
    </div>
    {durationFrames <= 0 && <div className="col-span-2"><UiEmpty title="没有可编辑的音频" /></div>}
  </div>
}

/** 画笔拖动中的轨迹预览（屏幕坐标即时绘制，松手后交给宿主变成修复记录）。 */
function BrushTrail({ points, radius, view, frequency, lanes }: { points: readonly AudioBrushPoint[]; radius: number; view: WaveformViewport; frequency: FrequencyView; lanes: number }) {
  const host = React.useRef<SVGSVGElement | null>(null)
  const [size, setSize] = React.useState({ width: 0, height: 0 })
  React.useLayoutEffect(() => { const rect = host.current?.getBoundingClientRect(); if (rect) setSize({ width: rect.width, height: rect.height }) }, [])
  const laneHeight = size.height / Math.max(1, lanes)
  const path = Array.from({ length: lanes }, (_, lane) => points.map((point, index) => `${index ? 'L' : 'M'}${xAtFrame(point.frame, size.width, view)},${lane * laneHeight + yAtHz(point.hz, laneHeight, frequency)}`).join(' ')).join(' ')
  // icon-token-allow: 修复画笔的轨迹是按指针坐标实时算出的图形，不是图标
  return <svg ref={host} className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
    <path d={path} fill="none" className="stroke-on-media/60" strokeWidth={radius * 2} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}
