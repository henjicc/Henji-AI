import { spectrogramHzAt, spectrogramPositionOf, type SpectrogramScale } from '@/core/audio/spectrogram'
import { clampViewport, zoomViewport, type WaveformViewport } from '../waveformViewport'

/*
 * 波形/频谱编辑区的交互模型（与界面无关的纯计算）：坐标换算、横纵缩放、选区与画笔笔画。
 * 横向：滚轮在内容上以指针为中心缩放时间；纵向：波形在 dB 刻度上滚轮缩放振幅，频谱在 Hz 刻度上滚轮缩放频率范围。
 * 两种视图共用同一个时间视口，所以横向缩放永远联动。
 */

/** 工具（模式，不是动作）：时间选区、框选频谱、修复画笔、平移。 */
export type AudioEditorTool = 'time' | 'marquee' | 'brush' | 'hand'

export interface AudioTimeSelection { start: number; end: number }
/** 频谱上的矩形选区（时间 + 频率）。 */
export interface AudioSpectralSelection extends AudioTimeSelection { lowHz: number; highHz: number }
export interface AudioBrushPoint { frame: number; hz: number }
/** 修复画笔的一笔：点列与画笔半径（时间用采样帧，频率用对数轴上的“倍频程”，与缩放无关）。 */
export interface AudioBrushStroke { points: AudioBrushPoint[]; radiusFrames: number; radiusOctaves: number }

export interface FrequencyView { minHz: number; maxHz: number; scale: SpectrogramScale }

export const AMPLITUDE_ZOOM_LIMITS = { min: 1, max: 64 } as const

export function frameAtX(x: number, width: number, view: WaveformViewport): number {
  return view.start + Math.max(0, Math.min(1, x / Math.max(1, width))) * (view.end - view.start)
}
export function xAtFrame(frame: number, width: number, view: WaveformViewport): number {
  return (frame - view.start) / Math.max(1e-9, view.end - view.start) * width
}
export function hzAtY(y: number, height: number, frequency: FrequencyView): number {
  return spectrogramHzAt(1 - Math.max(0, Math.min(1, y / Math.max(1, height))), frequency.minHz, frequency.maxHz, frequency.scale)
}
export function yAtHz(hz: number, height: number, frequency: FrequencyView): number {
  return (1 - spectrogramPositionOf(hz, frequency.minHz, frequency.maxHz, frequency.scale)) * height
}

/** 一格滚轮的缩放倍数；deltaY > 0（向下滚）缩小视野（看到更多）。触控板的细小增量按比例换算。 */
export function wheelZoomFactor(deltaY: number): number {
  return Math.exp(Math.max(-0.5, Math.min(0.5, deltaY * 0.0025)))
}

/** 时间缩放：以指针所在位置为中心，视野不小于 minimum 帧、不超出素材。 */
export function zoomTime(view: WaveformViewport, anchorRatio: number, deltaY: number, duration: number, minimum: number): WaveformViewport {
  return zoomViewport(view, anchorRatio, wheelZoomFactor(deltaY), duration, Math.min(duration, minimum))
}
export function panTime(view: WaveformViewport, deltaFrames: number, duration: number): WaveformViewport {
  return clampViewport(view.start + deltaFrames, view.end - view.start, duration)
}

/** 振幅缩放：向上滚放大（看清安静的部分），向下滚缩回；1 表示 0 dBFS 正好顶到行高。 */
export function zoomAmplitude(current: number, deltaY: number): number {
  return Math.max(AMPLITUDE_ZOOM_LIMITS.min, Math.min(AMPLITUDE_ZOOM_LIMITS.max, current / wheelZoomFactor(deltaY)))
}

/** 频率缩放：以指针所在频率为中心缩放可见频率范围（对数轴按对数缩放），不超出 [floor, nyquist]。 */
export function zoomFrequency(view: FrequencyView, anchorRatioFromBottom: number, deltaY: number, floorHz: number, nyquist: number): FrequencyView {
  const factor = wheelZoomFactor(deltaY)
  const toAxis = (hz: number) => view.scale === 'log' ? Math.log(hz) : hz
  const fromAxis = (value: number) => view.scale === 'log' ? Math.exp(value) : value
  const lowBound = toAxis(Math.max(floorHz, view.scale === 'log' ? 20 : 0))
  const highBound = toAxis(nyquist)
  const low = toAxis(Math.max(view.scale === 'log' ? 20 : 0, view.minHz))
  const high = toAxis(view.maxHz)
  const anchor = low + (high - low) * Math.max(0, Math.min(1, anchorRatioFromBottom))
  const minimumSpan = view.scale === 'log' ? Math.log(2) / 2 : 200
  const span = Math.min(highBound - lowBound, Math.max(minimumSpan, (high - low) * factor))
  let nextLow = anchor - (anchor - low) * span / Math.max(1e-9, high - low)
  nextLow = Math.max(lowBound, Math.min(highBound - span, nextLow))
  return { ...view, minHz: fromAxis(nextLow), maxHz: fromAxis(nextLow + span) }
}

export function normalizeTimeSelection(a: number, b: number, duration: number): AudioTimeSelection {
  const start = Math.max(0, Math.min(duration, Math.min(a, b)))
  const end = Math.max(0, Math.min(duration, Math.max(a, b)))
  return { start: Math.round(start), end: Math.round(end) }
}
export function normalizeSpectralSelection(a: AudioBrushPoint, b: AudioBrushPoint, duration: number, nyquist: number): AudioSpectralSelection {
  const time = normalizeTimeSelection(a.frame, b.frame, duration)
  return { ...time, lowHz: Math.max(0, Math.min(a.hz, b.hz)), highHz: Math.min(nyquist, Math.max(a.hz, b.hz)) }
}

/** 拖动距离小于这个像素数视为单击（定位播放头、取消选区）。 */
export const CLICK_SLOP_PX = 3

/** 把画笔在屏幕上的像素半径换算成与缩放无关的时间/频率半径。 */
export function brushRadius(pixels: number, width: number, height: number, view: WaveformViewport, frequency: FrequencyView): { radiusFrames: number; radiusOctaves: number } {
  const radiusFrames = pixels / Math.max(1, width) * (view.end - view.start)
  const octavesVisible = Math.log2(Math.max(frequency.minHz > 0 ? frequency.maxHz / Math.max(20, frequency.minHz) : frequency.maxHz / 20, 1.0001))
  return { radiusFrames, radiusOctaves: pixels / Math.max(1, height) * octavesVisible }
}

/** 笔画的包围矩形（加上半径），用来生成修复区域。 */
export function strokeBounds(stroke: AudioBrushStroke, duration: number, nyquist: number): AudioSpectralSelection {
  const frames = stroke.points.map(point => point.frame)
  const octave = 2 ** stroke.radiusOctaves
  return {
    start: Math.max(0, Math.round(Math.min(...frames) - stroke.radiusFrames)),
    end: Math.min(duration, Math.round(Math.max(...frames) + stroke.radiusFrames)),
    lowHz: Math.max(0, Math.min(...stroke.points.map(point => point.hz)) / octave),
    highHz: Math.min(nyquist, Math.max(...stroke.points.map(point => point.hz)) * octave),
  }
}

/** dB 刻度：给定振幅缩放，取能放下的整齐刻度（0、-3、-6、-12……），返回 dB 与对应的 0..1 振幅。 */
export function amplitudeTicks(zoom: number): Array<{ db: number; amplitude: number }> {
  const candidates = [0, -6, -12, -18, -24, -30, -36, -42, -48, -54, -60]
  const visible = candidates.map(db => ({ db, amplitude: 10 ** (db / 20) * zoom })).filter(tick => tick.amplitude <= 0.92 && tick.amplitude >= 0.2)
  // 太靠近中线的刻度挤在一起，留下彼此间隔足够的那些。
  const kept: Array<{ db: number; amplitude: number }> = []
  for (const tick of visible) if (!kept.length || kept[kept.length - 1].amplitude - tick.amplitude >= 0.18) kept.push(tick)
  return kept
}

/** 时间刻度步长（采样帧），让相邻刻度至少相隔 minPixels。 */
export function timeTickStep(view: WaveformViewport, width: number, sampleRate: number, minPixels = 80): number {
  const secondsPerPixel = (view.end - view.start) / Math.max(1, width) / Math.max(1, sampleRate)
  const target = secondsPerPixel * minPixels
  const steps = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600]
  return (steps.find(step => step >= target) ?? 3600) * sampleRate
}

export function formatTimecode(frames: number, sampleRate: number, stepFrames?: number): string {
  const seconds = Math.max(0, frames / Math.max(1, sampleRate))
  const minutes = Math.floor(seconds / 60)
  const rest = seconds - minutes * 60
  const decimals = stepFrames === undefined ? 3 : stepFrames / sampleRate >= 1 ? 0 : stepFrames / sampleRate >= 0.1 ? 1 : stepFrames / sampleRate >= 0.01 ? 2 : 3
  const text = rest.toFixed(decimals)
  return `${minutes}:${(decimals ? text.padStart(3 + decimals, '0') : text.padStart(2, '0'))}`
}

/* 删除 / 静音区间的边缘拖动（波形编辑区） */
export type CutEdge = { mode: 'delete' | 'mute'; start: number; end: number; side: 'start' | 'end' }
/** 区间边缘的抓取范围与吸附距离（CSS 像素） */
export const EDGE_HIT_PX = 6
const EDGE_SNAP_PX = 8

/** 拖到的位置：靠近别的区间边缘或这一段的另一边时吸附过去。 */
export function snapCutEdge(frame: number, edge: CutEdge, ranges: ReadonlyArray<{ start: number; end: number; mode: 'delete' | 'mute' | 'pending' }>, framesPerPixel: number): number {
  const own = edge.side === 'start' ? edge.start : edge.end
  const candidates = [edge.side === 'start' ? edge.end : edge.start,
    ...ranges.filter(range => range.mode !== 'pending').flatMap(range => [range.start, range.end]).filter(value => value !== own)]
  let best = frame, distance = EDGE_SNAP_PX * framesPerPixel
  for (const candidate of candidates) if (Math.abs(candidate - frame) <= distance) { best = candidate; distance = Math.abs(candidate - frame) }
  return best
}

/** 松手后的编辑：外拖扩、内拖撤、拖到另一边撤整段。 */
export function cutEdgeEdit(edge: CutEdge, frame: number): { range: { start: number; end: number }; mode: 'delete' | 'mute'; action: 'add' | 'remove' } | null {
  const { mode, start, end } = edge
  if (edge.side === 'end') {
    if (frame > end) return { range: { start: end, end: frame }, mode, action: 'add' }
    if (frame < end) return { range: { start: frame <= start ? start : frame, end }, mode, action: 'remove' }
  } else {
    if (frame < start) return { range: { start: frame, end: start }, mode, action: 'add' }
    if (frame > start) return { range: { start, end: frame >= end ? end : frame }, mode, action: 'remove' }
  }
  return null
}
