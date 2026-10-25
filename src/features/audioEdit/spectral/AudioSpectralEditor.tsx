import React from 'react'
import { SpectrogramView } from '@/components/audio/SpectrogramView'
import { UiEmpty, UiError, UiLoading } from '@/components/ui'
import { UI_TEXT_TIMECODE_CLASS } from '@/components/ui/styleTokens'
import { WaveformView } from '@/components/waveform/WaveformView'
import type { WaveformPalette } from '@/components/waveform/waveformDraw'
import { formatSpectrogramHz, spectrogramTicks } from '@/core/audio/spectrogram'
import type { SpectralTileSet } from '@/core/audio/spectralTiles'
import { AUDIO_SCOPE_COLORS } from '@/core/theme/colorTokens'
import type { WaveformState } from '@/hooks/useWaveformData'
import { AUDIO_EDIT_MIN_VIEW_FRAMES, clampViewport, type WaveformViewport } from '../waveformViewport'
import {
  amplitudeTicks, brushRadius, CLICK_SLOP_PX, cutEdgeEdit, EDGE_HIT_PX, formatTimecode, frameAtX, hzAtY, normalizeSpectralSelection, normalizeTimeSelection, panTime, timeTickStep, xAtFrame, yAtHz,
  snapCutEdge, zoomAmplitude, zoomFrequency, zoomTime, type CutEdge,
  type AudioBrushPoint, type AudioBrushStroke, type AudioEditorTool, type AudioSpectralSelection, type AudioTimeSelection, type FrequencyView,
} from './spectralEditorModel'

export type AudioEditorDisplay = 'both' | 'waveform' | 'spectrum'
export interface AudioEditorRegion { id: string; start: number; end: number; lowHz?: number; highHz?: number }
/** 播放位置的来源：播放时每帧都在变，编辑区直接改播放头的位置，不经过 React 重新渲染。 */
export interface AudioPlayheadSource { current: () => number; subscribe: (listener: (frame: number) => void) => () => void }

export interface AudioSpectralEditorProps {
  sampleRate: number
  durationFrames: number
  waveform: WaveformState
  spectrogram?: SpectralTileSet
  spectrogramStatus: 'idle' | 'loading' | 'ready' | 'error'
  spectrogramError?: string
  onRetrySpectrogram?: () => void
  view: WaveformViewport
  onViewChange: (view: WaveformViewport) => void
  display: AudioEditorDisplay
  tool: AudioEditorTool
  /** 修复画笔的屏幕半径（CSS 像素）。 */
  brushPixels: number
  playhead: AudioPlayheadSource
  /** 波形显示增益：试听开着自动增益时，波形按放大后的电平画，看到的就是听到的。 */
  displayGain?: number
  onSeek: (frame: number) => void
  /** 明确的试听手势：单击只定位，拖动和键盘单步才出声。 */
  onScrubStart?: (frame: number) => void
  onScrubMove?: (frame: number) => void
  onScrubEnd?: () => void
  onScrubStep?: (frame: number) => void
  selection: AudioTimeSelection | null
  onSelectionChange: (selection: AudioTimeSelection | null) => void
  spectralSelection: AudioSpectralSelection | null
  onSpectralSelectionChange: (selection: AudioSpectralSelection | null) => void
  onBrushStroke: (stroke: AudioBrushStroke) => void
  /** 已删除 / 已静音 / 待处理（停顿预览）的区间（源采样帧），在两个视图上叠一层标记。 */
  cutRanges: ReadonlyArray<{ start: number; end: number; mode: 'delete' | 'mute' | 'pending' }>
  /**
   * 拖动删除 / 静音区间的边缘：往外拖把这种处理扩到拖过的范围（add），往里拖撤掉拖过的部分（remove），
   * 拖到和另一边重合就撤掉整段。不传则区间只显示、不能拖。
   */
  onCutEdgeEdit?: (edit: { range: { start: number; end: number }; mode: 'delete' | 'mute'; action: 'add' | 'remove' }) => void
  /** 拖边缘时是否吸附（到其它区间的边缘与 snapFrames）；关着时随指针无极调节 */
  snapEnabled?: boolean
  /** 拖边缘时额外吸附的位置（如字声音的起止），源采样帧 */
  snapFrames?: readonly number[]
  /** 已有的修复记录：频谱上画出轮廓，方便找到改过的地方。 */
  repairs: readonly AudioEditorRegion[]
  /** 右键编辑区：宿主弹出针对选区的菜单。 */
  onContextMenu?: (event: React.MouseEvent) => void
  /** 刻度下方的字幕条（宿主按可见区间排好），没有转写稿时不传。 */
  captionLane?: React.ReactNode
  empty?: boolean
  recordingOverlay?: (mode: Pane, frequency: FrequencyView) => React.ReactNode
  insertion?: { start: number; frames: number; replace: boolean }
}

const RULER_WIDTH = 'w-11'
const DEFAULT_SPLIT = 0.45
const SCOPE_WAVE_PALETTE: Partial<WaveformPalette> = { wave: AUDIO_SCOPE_COLORS.wave, wavePlayed: AUDIO_SCOPE_COLORS.wave, clipWave: AUDIO_SCOPE_COLORS.wave, waveCut: AUDIO_SCOPE_COLORS.waveCut, line: AUDIO_SCOPE_COLORS.grid, lineStrong: AUDIO_SCOPE_COLORS.grid }
const NAVIGATOR_PALETTE: Partial<WaveformPalette> = { ...SCOPE_WAVE_PALETTE, wave: AUDIO_SCOPE_COLORS.navigatorWave, wavePlayed: AUDIO_SCOPE_COLORS.navigatorWave, clipWave: AUDIO_SCOPE_COLORS.navigatorWave }

type Pane = 'waveform' | 'spectrum'
type Drag =
  | { kind: 'time'; pointer: number; origin: number; x: number; moved: boolean }
  | { kind: 'marquee'; pointer: number; origin: AudioBrushPoint; x: number; y: number; moved: boolean }
  | { kind: 'brush'; pointer: number; points: AudioBrushPoint[] }
  | { kind: 'pan'; pointer: number; x: number; view: WaveformViewport }
  | { kind: 'split'; pointer: number; y: number; top: number; height: number }
  | { kind: 'playhead'; pointer: number; x: number; moved: boolean; frame: number }
  | { kind: 'navigator'; pointer: number; x: number; width: number; view: WaveformViewport; edge: 'left' | 'right' | 'move' }
  | { kind: 'cutEdge'; pointer: number; x: number; moved: boolean; edge: CutEdge; frame: number }

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
 * 视口变化按帧合并：一帧里的多次滚轮或拖动只提交最后一次，连续操作时以待提交的视口为准继续累加。
 */
function useFrameViewport(view: WaveformViewport, onViewChange: (view: WaveformViewport) => void): { latest: () => WaveformViewport; request: (next: WaveformViewport) => void } {
  const pending = React.useRef<WaveformViewport | null>(null)
  const frame = React.useRef<number | null>(null)
  const commit = React.useRef(onViewChange)
  commit.current = onViewChange
  React.useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current) }, [])
  return {
    latest: () => pending.current ?? view,
    request: (next) => {
      pending.current = next
      if (frame.current !== null) return
      frame.current = requestAnimationFrame(() => {
        frame.current = null
        const value = pending.current
        pending.current = null
        if (value) commit.current(value)
      })
    },
  }
}

/**
 * 波形 + 频谱编辑区（参照 Audition 的波形编辑器）：顶部导航条看全局，上下两种视图共用一个时间视口，横向缩放永远联动。
 * - 内容区滚轮：以指针为中心缩放时间；Shift + 滚轮或按住滚轮拖动：平移。
 * - 右侧 dB 刻度上滚轮：波形纵向缩放；Hz 刻度上滚轮：频谱频率范围缩放。
 * - 左键拖动按当前工具：时间选区 / 频谱框选 / 修复画笔 / 平移；单击定位播放头并取消选区。
 * - 时间刻度上的播放头把手可以拖动；导航条拖动选框平移、拖左右边缘缩放、点空白处跳转。
 * 只负责显示与手势，编辑动作（删除、静音、修复）由宿主根据选区执行。
 */
export function AudioSpectralEditor(props: AudioSpectralEditorProps) {
  const { sampleRate, durationFrames, view, display, tool, selection, spectralSelection } = props
  const nyquist = (props.spectrogram?.sampleRate ?? sampleRate) / 2
  const [amplitudeZoom, setAmplitudeZoom] = React.useState(1)
  const [frequency, setFrequency] = React.useState<FrequencyView>({ minHz: 20, maxHz: nyquist, scale: 'log' })
  const [split, setSplit] = React.useState(DEFAULT_SPLIT)
  const [trail, setTrail] = React.useState(0)
  const [brushHover, setBrushHover] = React.useState<{ x: number; y: number } | null>(null)
  const [edgeHover, setEdgeHover] = React.useState(false)
  const [edgePreview, setEdgePreview] = React.useState<{ edge: CutEdge; frame: number } | null>(null)
  const [contentWidth, setContentWidth] = React.useState(800)
  const drag = React.useRef<Drag | null>(null)
  const endScrub = React.useRef(props.onScrubEnd)
  endScrub.current = props.onScrubEnd
  React.useEffect(() => () => {
    if (drag.current?.kind === 'playhead' && drag.current.moved) endScrub.current?.()
  }, [])
  const brushPoints = React.useRef<AudioBrushPoint[] | null>(null)
  const trailFrame = React.useRef<number | null>(null)
  const content = React.useRef<HTMLDivElement | null>(null)
  const navigator = React.useRef<HTMLDivElement | null>(null)
  const ruler = React.useRef<HTMLDivElement | null>(null)
  const waveRuler = React.useRef<HTMLDivElement | null>(null)
  const spectrumRuler = React.useRef<HTMLDivElement | null>(null)
  const spectrumPane = React.useRef<HTMLDivElement | null>(null)
  const hoverLine = React.useRef<HTMLDivElement | null>(null)
  const hoverLabel = React.useRef<HTMLSpanElement | null>(null)
  const playheadNodes = React.useRef(new Map<string, HTMLElement>())
  const channels = props.waveform.data?.pyramid.channelCount ?? props.spectrogram?.channels ?? 1
  const lanes = React.useMemo(() => Array.from({ length: channels }, (_, index) => index), [channels])
  const viewport = useFrameViewport(view, props.onViewChange)

  React.useEffect(() => { setFrequency(previous => ({ ...previous, maxHz: Math.min(previous.maxHz, nyquist) || nyquist })) }, [nyquist])
  React.useLayoutEffect(() => {
    const element = content.current
    if (!element || typeof ResizeObserver === 'undefined') return
    let frame: number | null = null
    const observer = new ResizeObserver(([entry]) => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => { frame = null; setContentWidth(entry.contentRect.width) })
    })
    observer.observe(element)
    return () => { observer.disconnect(); if (frame !== null) cancelAnimationFrame(frame) }
  }, [])

  // 播放头：直接改各条竖线的位置（导航条、刻度把手、内容区），不让整块编辑区每帧重新渲染。
  const viewRef = React.useRef(view)
  viewRef.current = view
  const placePlayhead = React.useCallback((frame: number) => {
    const current = viewRef.current
    const inView = frame >= current.start && frame <= current.end
    for (const [key, node] of playheadNodes.current) {
      if (key === 'navigator') { node.style.left = `${Math.max(0, Math.min(100, frame / Math.max(1, durationFrames) * 100))}%`; continue }
      node.style.left = `${xAtFrame(frame, 100, current)}%`
      // 不在可见区时只是看不见（把手仍保留在无障碍树里，键盘仍可操作）
      node.style.opacity = inView ? '1' : '0'
      node.style.pointerEvents = inView ? '' : 'none'
      if (key === 'handle') { node.setAttribute('aria-valuenow', String(Math.round(frame))); node.setAttribute('aria-valuetext', formatTimecode(frame, sampleRate)) }
    }
  }, [durationFrames, sampleRate])
  const { playhead } = props
  React.useEffect(() => playhead.subscribe(placePlayhead), [playhead, placePlayhead])
  React.useLayoutEffect(() => { placePlayhead(playhead.current()) }, [view, playhead, placePlayhead, display, split])
  const playheadRef = (key: string) => (node: HTMLElement | null) => { if (node) playheadNodes.current.set(key, node); else playheadNodes.current.delete(key) }

  const showWave = display !== 'spectrum'
  const showSpectrum = display !== 'waveform'
  const minimumView = Math.min(durationFrames, AUDIO_EDIT_MIN_VIEW_FRAMES)

  useNonPassiveWheel(content, (event) => {
    if (durationFrames <= 0) return
    event.preventDefault()
    const rect = content.current!.getBoundingClientRect()
    const current = viewport.latest()
    if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      const delta = (event.shiftKey ? event.deltaY : event.deltaX) / Math.max(1, rect.width) * (current.end - current.start)
      viewport.request(panTime(current, delta, durationFrames))
      return
    }
    viewport.request(zoomTime(current, (event.clientX - rect.left) / Math.max(1, rect.width), event.deltaY, durationFrames, minimumView))
  })
  useNonPassiveWheel(navigator, (event) => {
    if (durationFrames <= 0) return
    event.preventDefault()
    // 导航条上滚轮以当前可见区的中心缩放（指针在导航条上的位置对应的是整段，不是可见区）。
    viewport.request(zoomTime(viewport.latest(), 0.5, event.deltaY, durationFrames, minimumView))
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
  /** 指针附近可以抓的区间边缘：优先从区间里面抓的那一边（红蓝相接处从哪边抓就改哪种），再取最近的。 */
  const cutEdgeAt = (x: number, width: number): CutEdge | null => {
    if (!props.onCutEdgeEdit || tool === 'hand' || tool === 'brush') return null
    let best: (CutEdge & { distance: number; inside: boolean }) | null = null
    for (const range of props.cutRanges) {
      if (range.mode === 'pending') continue
      for (const side of ['start', 'end'] as const) {
        const edgeX = xAtFrame(side === 'start' ? range.start : range.end, width, view)
        const distance = Math.abs(x - edgeX)
        if (distance > EDGE_HIT_PX) continue
        const inside = side === 'start' ? x >= edgeX : x <= edgeX
        if (!best || (inside && !best.inside) || (inside === best.inside && distance < best.distance)) best = { mode: range.mode, start: range.start, end: range.end, side, distance, inside }
      }
    }
    return best && { mode: best.mode, start: best.start, end: best.end, side: best.side }
  }
  const scheduleTrail = () => {
    if (trailFrame.current !== null) return
    trailFrame.current = requestAnimationFrame(() => { trailFrame.current = null; setTrail(value => value + 1) })
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.button !== 0 && event.button !== 1) || durationFrames <= 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const pane = paneAt(event.clientY)
    event.currentTarget.setPointerCapture(event.pointerId)
    // 按住滚轮（中键）拖动：任何工具下都是平移。
    if (event.button === 1 || tool === 'hand') { event.preventDefault(); drag.current = { kind: 'pan', pointer: event.pointerId, x: event.clientX, view }; return }
    const edge = cutEdgeAt(x, rect.width)
    if (edge) {
      const frame = edge.side === 'start' ? edge.start : edge.end
      drag.current = { kind: 'cutEdge', pointer: event.pointerId, x: event.clientX, moved: false, edge, frame }
      setEdgePreview({ edge, frame }); return
    }
    if (pane === 'spectrum' && tool === 'brush') {
      const point = spectrumPoint(event.clientX, event.clientY)
      brushPoints.current = [point]
      drag.current = { kind: 'brush', pointer: event.pointerId, points: brushPoints.current }; scheduleTrail(); return
    }
    if (pane === 'spectrum' && tool === 'marquee') {
      drag.current = { kind: 'marquee', pointer: event.pointerId, origin: spectrumPoint(event.clientX, event.clientY), x: event.clientX, y: event.clientY, moved: false }; return
    }
    drag.current = { kind: 'time', pointer: event.pointerId, origin: frameAtX(x, rect.width, view), x: event.clientX, moved: false }
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    // 悬停竖线与时间读数：直接改样式，不触发渲染。
    if (hoverLine.current) { hoverLine.current.style.display = ''; hoverLine.current.style.left = `${x}px` }
    if (hoverLabel.current) {
      const label = hoverLabel.current
      label.style.display = ''; label.textContent = formatTimecode(frameAtX(x, rect.width, view), sampleRate)
      // 靠近右缘时读数翻到竖线左边，不被编辑区裁掉（重要记录 020，尺寸扫描发现）
      const width = label.offsetWidth
      label.style.left = `${x + 4 + width > rect.width ? Math.max(0, x - 4 - width) : x + 4}px`
    }
    if (tool === 'brush') setBrushHover(paneAt(event.clientY) === 'spectrum' ? { x, y: event.clientY - rect.top } : null)
    const current = drag.current
    if (!current) setEdgeHover(Boolean(cutEdgeAt(x, rect.width)))
    if (!current || current.pointer !== event.pointerId) return
    if (current.kind === 'cutEdge') {
      current.moved ||= Math.abs(event.clientX - current.x) > CLICK_SLOP_PX
      if (!current.moved) return
      const raw = Math.max(0, Math.min(durationFrames, Math.round(frameAtX(x, rect.width, view))))
      current.frame = props.snapEnabled ? snapCutEdge(raw, current.edge, props.cutRanges, (view.end - view.start) / Math.max(1, rect.width), props.snapFrames) : raw
      setEdgePreview({ edge: current.edge, frame: current.frame }); return
    }
    if (current.kind === 'pan') { viewport.request(panTime(current.view, -(event.clientX - current.x) / Math.max(1, rect.width) * (current.view.end - current.view.start), durationFrames)); return }
    if (current.kind === 'brush') { current.points.push(spectrumPoint(event.clientX, event.clientY)); scheduleTrail(); return }
    if (current.kind === 'marquee') {
      current.moved ||= Math.hypot(event.clientX - current.x, event.clientY - current.y) > CLICK_SLOP_PX
      if (current.moved) props.onSpectralSelectionChange(normalizeSpectralSelection(current.origin, spectrumPoint(event.clientX, event.clientY), durationFrames, nyquist))
      return
    }
    if (current.kind === 'time') {
      current.moved ||= Math.abs(event.clientX - current.x) > CLICK_SLOP_PX
      if (current.moved) props.onSelectionChange(normalizeTimeSelection(current.origin, frameAtX(x, rect.width, view), durationFrames))
    }
  }
  const finish = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || current.pointer !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const rect = event.currentTarget.getBoundingClientRect()
    if (current.kind === 'cutEdge') {
      setEdgePreview(null)
      const edit = current.moved ? cutEdgeEdit(current.edge, current.frame) : null
      if (edit) props.onCutEdgeEdit?.(edit)
      else props.onSeek(Math.round(frameAtX(event.clientX - rect.left, rect.width, view)))
      return
    }
    if (current.kind === 'brush') {
      brushPoints.current = null; setTrail(value => value + 1)
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
  const leave = () => {
    if (hoverLine.current) hoverLine.current.style.display = 'none'
    if (hoverLabel.current) hoverLabel.current.style.display = 'none'
    setBrushHover(null)
  }

  // 刻度区：按下即定位播放头并可拖动（把手与刻度空白处一样）。
  const rulerFrame = (clientX: number) => { const rect = ruler.current!.getBoundingClientRect(); return Math.round(frameAtX(clientX - rect.left, rect.width, view)) }
  const onRulerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || durationFrames <= 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const frame = rulerFrame(event.clientX)
    drag.current = { kind: 'playhead', pointer: event.pointerId, x: event.clientX, moved: false, frame }
    props.onSeek(frame)
  }
  const onRulerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (current?.kind !== 'playhead' || current.pointer !== event.pointerId) return
    if (!current.moved) {
      if (Math.abs(event.clientX - current.x) <= CLICK_SLOP_PX) return
      current.moved = true
      props.onScrubStart?.(current.frame)
    }
    const frame = rulerFrame(event.clientX)
    if (frame === current.frame) return
    current.frame = frame
    if (props.onScrubMove) props.onScrubMove(frame)
    else props.onSeek(frame)
  }
  const onRulerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (current?.kind !== 'playhead' || current.pointer !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (current.moved) props.onScrubEnd?.()
  }
  const onHandleKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? sampleRate : Math.max(1, Math.round((view.end - view.start) / 100))
    const frame = playhead.current()
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const next = Math.max(0, Math.min(durationFrames, frame + (event.key === 'ArrowLeft' ? -step : step)))
      if (next !== frame) (props.onScrubStep ?? props.onSeek)(next)
    }
    else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); props.onSeek(event.key === 'Home' ? 0 : durationFrames) }
  }

  // 导航条：拖动选框平移，拖左右边缘缩放，点空白处把可见区中心移过去。
  const onNavigatorDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || durationFrames <= 0) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const target = event.target instanceof Element ? event.target.closest('[data-navigator-edge]') : null
    const edge = (target?.getAttribute('data-navigator-edge') ?? 'jump') as 'left' | 'right' | 'move' | 'jump'
    const current = viewport.latest()
    const next = edge === 'jump' ? clampViewport((event.clientX - rect.left) / rect.width * durationFrames - (current.end - current.start) / 2, current.end - current.start, durationFrames) : current
    if (edge === 'jump') viewport.request(next)
    drag.current = { kind: 'navigator', pointer: event.pointerId, x: event.clientX, width: rect.width, view: next, edge: edge === 'jump' ? 'move' : edge }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onNavigatorMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (current?.kind !== 'navigator' || current.pointer !== event.pointerId) return
    const delta = (event.clientX - current.x) / Math.max(1, current.width) * durationFrames
    if (current.edge === 'left') viewport.request({ start: Math.max(0, Math.min(current.view.end - minimumView, current.view.start + delta)), end: current.view.end })
    else if (current.edge === 'right') viewport.request({ start: current.view.start, end: Math.min(durationFrames, Math.max(current.view.start + minimumView, current.view.end + delta)) })
    else viewport.request(clampViewport(current.view.start + delta, current.view.end - current.view.start, durationFrames))
  }
  const onNavigatorUp = (event: React.PointerEvent<HTMLDivElement>) => { if (drag.current?.kind === 'navigator') { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId) } }

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
  const cursor = edgeHover || edgePreview ? 'cursor-ew-resize' : tool === 'hand' ? 'cursor-grab' : tool === 'brush' && brushHover ? 'cursor-none' : tool === 'marquee' ? 'cursor-crosshair' : 'cursor-text'
  // 拖动边缘时就地预览：被拖的那一段按新的边界画，外拖越过另一种处理时两种颜色叠在一起
  const shownCuts = edgePreview ? props.cutRanges.map(range => range.mode === edgePreview.edge.mode && range.start === edgePreview.edge.start && range.end === edgePreview.edge.end
    ? { ...range, ...(edgePreview.edge.side === 'start' ? { start: Math.min(edgePreview.frame, range.end) } : { end: Math.max(edgePreview.frame, range.start) }) } : range) : props.cutRanges
  const step = timeTickStep(view, contentWidth, sampleRate)
  const ticks: number[] = []
  for (let frame = Math.ceil(view.start / step) * step; frame <= view.end && ticks.length < 200; frame += step) ticks.push(frame)
  const displayGain = props.displayGain ?? 1
  // 刻度标的是原始电平：显示增益与纵向缩放一起换算到刻度位置。
  const waveTicks = amplitudeTicks(amplitudeZoom * displayGain)
  const hzTicks = spectrogramTicks(frequency.minHz, frequency.maxHz, frequency.scale)
  const laneFraction = 100 / Math.max(1, channels)
  const total = Math.max(1, durationFrames)
  const selectionStyle = { background: AUDIO_SCOPE_COLORS.selection, borderColor: AUDIO_SCOPE_COLORS.selectionEdge }

  const spectrumBody = (range: WaveformViewport) => props.spectrogramStatus === 'error'
    ? <UiError message={props.spectrogramError ?? '频谱图没有生成出来。'} {...(props.onRetrySpectrogram ? { onRetry: props.onRetrySpectrogram } : {})} />
    : props.spectrogramStatus === 'loading' && !props.spectrogram ? <UiLoading message="正在生成频谱图…" />
      : <SpectrogramView {...(props.spectrogram ? { tiles: props.spectrogram } : {})} lanes={lanes} startFrame={range.start} endFrame={range.end} minHz={frequency.minHz} maxHz={frequency.maxHz} scale={frequency.scale} label="频谱图" />
  const waveBody = (range: WaveformViewport) => <WaveformView waveform={props.waveform} startSeconds={range.start / sampleRate} endSeconds={range.end / sampleRate} lanes={lanes} gain={amplitudeZoom * displayGain} palette={SCOPE_WAVE_PALETTE} layers="single" label="音频波形" />
  // 原素材在插入点之后向右移动；仅绘制视口内的两段，复用既有波形与频谱数据。
  const sourceBody = (render: (range: WaveformViewport) => React.ReactNode): React.ReactNode => {
    const insertion = props.insertion
    if (!insertion) return render(view)
    const right = insertion.start + insertion.frames
    const delta = insertion.replace ? 0 : insertion.frames
    return [{ start: view.start, end: Math.min(view.end, insertion.start), delta: 0 }, { start: Math.max(view.start, right), end: view.end, delta }].filter(part => part.end > part.start).map((part, index) => <div key={index} className="absolute inset-y-0 overflow-hidden" style={spanStyle(part.start, part.end)}>{render({ start: part.start - part.delta, end: part.end - part.delta })}</div>)
  }

  return <div className="grid h-full min-h-0 select-none grid-cols-[minmax(0,1fr)_auto] grid-rows-[20px_22px_auto_minmax(0,1fr)] bg-panel" data-audio-spectral-editor data-tool={tool} data-display={display} data-spectrogram-status={props.spectrogramStatus}
    data-view-start={Math.round(view.start)} data-view-end={Math.round(view.end)}>
    {/* 导航条：整段的缩略波形，框住的是当前可见范围 */}
    <div ref={navigator} className="relative mx-1 mt-1 touch-none overflow-hidden rounded-hairline" style={{ background: AUDIO_SCOPE_COLORS.navigator }} aria-label="全局导航：拖动选框平移，拖左右边缘缩放，点空白处跳转"
      onPointerDown={onNavigatorDown} onPointerMove={onNavigatorMove} onPointerUp={onNavigatorUp} onPointerCancel={onNavigatorUp} onLostPointerCapture={() => { if (drag.current?.kind === 'navigator') drag.current = null }}>
      {props.waveform.data && <div className="pointer-events-none absolute inset-0"><WaveformView waveform={props.waveform} tier="mini" startSeconds={0} endSeconds={durationFrames / Math.max(1, sampleRate)} palette={NAVIGATOR_PALETTE} /></div>}
      <div data-navigator-edge="move" className="absolute inset-y-0 cursor-grab rounded-hairline border active:cursor-grabbing"
        style={{ left: `${view.start / total * 100}%`, width: `${Math.max(0.4, (view.end - view.start) / total * 100)}%`, background: AUDIO_SCOPE_COLORS.viewWindow, borderColor: AUDIO_SCOPE_COLORS.viewWindowEdge }}>
        {(['left', 'right'] as const).map(edge => <div key={edge} data-navigator-edge={edge} className={`absolute inset-y-0 w-2 cursor-ew-resize ${edge === 'left' ? '-left-1' : '-right-1'}`} />)}
      </div>
      <div ref={playheadRef('navigator')} className="pointer-events-none absolute inset-y-0 w-px" style={{ background: AUDIO_SCOPE_COLORS.playhead }} />
    </div>
    <div className={`${RULER_WIDTH}`} aria-hidden />

    {/* 时间刻度：按下定位播放头，拖动把手或刻度跟着走 */}
    <div ref={ruler} className="relative cursor-pointer touch-none overflow-hidden border-b border-line" onPointerDown={onRulerDown} onPointerMove={onRulerMove} onPointerUp={onRulerUp} onPointerCancel={onRulerUp} onLostPointerCapture={onRulerUp}>
      {ticks.map(frame => <div key={frame} className="pointer-events-none absolute inset-y-0 flex items-end" style={{ left: percentX(frame) }}>
        <span className="h-1.5 w-px bg-line-strong" />
        <span className={`${UI_TEXT_TIMECODE_CLASS} absolute bottom-1 left-1 whitespace-nowrap text-2xs text-text3`}>{formatTimecode(frame, sampleRate, step)}</span>
      </div>)}
      {selection && visible(selection.start, selection.end) && <div className="pointer-events-none absolute inset-y-0" style={{ ...spanStyle(selection.start, selection.end), background: AUDIO_SCOPE_COLORS.selection }} />}
      <span ref={hoverLabel} className={`${UI_TEXT_TIMECODE_CLASS} pointer-events-none absolute top-0.5 z-raised whitespace-nowrap rounded-hairline bg-panel px-0.5 text-2xs text-text1`} style={{ display: 'none' }} />
      <div ref={playheadRef('handle')} role="slider" tabIndex={0} aria-label="播放位置" aria-valuemin={0} aria-valuemax={durationFrames} onKeyDown={onHandleKey}
        className="absolute bottom-0 h-full w-3 -translate-x-1/2 cursor-ew-resize outline-none focus-visible:ring-2 focus-visible:ring-accent-ring" data-audio-playhead-handle data-ui-manipulator>
        {/* 播放头把手：倒三角，与 Audition 一致画在刻度底部 */}
        <svg viewBox="0 0 12 9" className="absolute bottom-0 left-0 h-[9px] w-3" aria-hidden>{/* icon-token-allow: 播放头把手是定位图形，不是图标 */}<path d="M0 0h12L6 9z" fill={AUDIO_SCOPE_COLORS.playheadHandle} /></svg>
      </div>
    </div>
    <div className={`${RULER_WIDTH} border-b border-l border-line`} aria-hidden />
    {props.captionLane ? <div className="relative h-7 overflow-hidden border-b border-gap">{props.captionLane}</div> : <div />}
    {props.captionLane ? <div className={`${RULER_WIDTH} border-b border-l border-gap`} aria-hidden /> : <div />}

    {/* 内容区：波形在上、频谱在下，共用时间视口 */}
    <div ref={content} className={`relative flex min-h-0 touch-none flex-col overflow-hidden ${cursor}`} style={{ background: AUDIO_SCOPE_COLORS.background }} role="application" aria-label="音频波形与频谱编辑区"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { if (drag.current?.kind === 'brush') { brushPoints.current = null; setTrail(value => value + 1) } if (drag.current?.kind === 'cutEdge') setEdgePreview(null); drag.current = null }}
      onPointerLeave={leave} onContextMenu={props.onContextMenu} onAuxClick={event => event.preventDefault()}>
      {showWave && <div className="relative min-h-0" style={{ height: showSpectrum ? `${split * 100}%` : '100%' }}>
        {lanes.map(lane => <div key={lane} className="pointer-events-none absolute inset-x-0 h-px" style={{ top: `${(lane + 0.5) * laneFraction}%`, background: AUDIO_SCOPE_COLORS.grid }} />)}
        {props.waveform.data
          ? sourceBody(waveBody)
          : props.waveform.status === 'error' ? <UiError message={props.waveform.error ?? '波形没有读出来。'} /> : props.empty ? !props.recordingOverlay && <UiEmpty title="按 Shift+空格 开始录音" /> : <UiLoading message="正在读取波形…" />}
        {props.recordingOverlay?.('waveform', frequency)}
        {lanes.slice(1).map(lane => <div key={lane} className="pointer-events-none absolute inset-x-0 h-px bg-line" style={{ top: `${lane * laneFraction}%` }} />)}
      </div>}
      {showWave && showSpectrum && <div className="relative h-1.5 shrink-0 cursor-row-resize bg-gap hover:bg-hover" role="separator" aria-orientation="horizontal" aria-label="调整波形与频谱的高度"
        onPointerDown={onSplitDown} onPointerMove={onSplitMove} onPointerUp={onSplitUp} />}
      {showSpectrum && <div ref={spectrumPane} className="relative min-h-0 flex-1">
        {sourceBody(spectrumBody)}
        {props.recordingOverlay?.('spectrum', frequency)}
        {lanes.slice(1).map(lane => <div key={lane} className="pointer-events-none absolute inset-x-0 h-px bg-gap" style={{ top: `${lane * laneFraction}%` }} />)}
        {/* 修复记录与框选只在频谱上有频率维度 */}
        {lanes.map(lane => <React.Fragment key={lane}>
          {props.repairs.filter(region => visible(region.start, region.end) && region.lowHz !== undefined).map(region => <div key={region.id} className="pointer-events-none absolute border border-dashed border-on-media/70"
            style={{ ...spanStyle(region.start, region.end), top: `${lane * laneFraction + yAtHz(region.highHz!, laneFraction, frequency)}%`, height: `${yAtHz(region.lowHz!, laneFraction, frequency) - yAtHz(region.highHz!, laneFraction, frequency)}%` }} />)}
          {spectralSelection && visible(spectralSelection.start, spectralSelection.end) && <div className="pointer-events-none absolute border"
            style={{ ...spanStyle(spectralSelection.start, spectralSelection.end), ...selectionStyle, top: `${lane * laneFraction + yAtHz(spectralSelection.highHz, laneFraction, frequency)}%`, height: `${yAtHz(spectralSelection.lowHz, laneFraction, frequency) - yAtHz(spectralSelection.highHz, laneFraction, frequency)}%` }} />}
        </React.Fragment>)}
        {brushPoints.current && <BrushTrail version={trail} points={brushPoints.current} radius={props.brushPixels} view={view} frequency={frequency} lanes={channels} />}
        {tool === 'brush' && brushHover && !brushPoints.current && spectrumPane.current && <div className="pointer-events-none absolute rounded-full border border-on-media"
          style={{ left: brushHover.x - props.brushPixels, top: brushHover.y - spectrumPane.current.offsetTop - props.brushPixels, width: props.brushPixels * 2, height: props.brushPixels * 2 }} />}
      </div>}
      {/* 跨两种视图的标记：删除/静音、时间选区、悬停线、播放头 */}
      {shownCuts.filter(range => range.end > range.start && visible(range.start, range.end)).map(range => <div key={`${range.mode}:${range.start}-${range.end}`} className="pointer-events-none absolute inset-y-0" data-audio-overlay={range.mode === 'pending' ? 'preview' : range.mode === 'delete' ? 'deleted' : 'mute'}
        style={{ ...spanStyle(range.start, range.end), background: AUDIO_SCOPE_COLORS[range.mode === 'delete' ? 'deleted' : range.mode === 'mute' ? 'muted' : 'pending'] }} />)}
      {selection && visible(selection.start, selection.end) && <div className="pointer-events-none absolute inset-y-0 border-x" data-audio-selection style={{ ...spanStyle(selection.start, selection.end), ...selectionStyle }} />}
      <div ref={hoverLine} className="pointer-events-none absolute inset-y-0 w-px" style={{ display: 'none', background: AUDIO_SCOPE_COLORS.hover }} />
      <div ref={playheadRef('content')} className="pointer-events-none absolute inset-y-0 w-px" style={{ background: AUDIO_SCOPE_COLORS.playhead }} data-audio-playhead />
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

/** 画笔拖动中的轨迹预览（屏幕坐标即时绘制，松手后交给宿主变成修复记录）；每帧最多重画一次。 */
function BrushTrail({ points, radius, view, frequency, lanes }: { version: number; points: readonly AudioBrushPoint[]; radius: number; view: WaveformViewport; frequency: FrequencyView; lanes: number }) {
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
