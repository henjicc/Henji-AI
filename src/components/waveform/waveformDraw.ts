import { aggregateWaveformLevel, aggregateWaveformSamples, selectWaveformLevel } from '@/core/media/waveformPyramid'
import type { WaveformData, WaveformDetailWindow } from '@/services/waveform/waveformDataService'

/**
 * 波形的唯一绘制实现（任务 2.3，设计稿 Waveform.dc.html）：Canvas 2D 按设备像素逐列取数据。
 * - 迷你：只画峰值层；标准：峰值层（半透明）+ 响度层（实色）；
 * - 列比第 0 级还细且已回读原始采样时改用采样聚合；每个采样间距 ≥ 2 CSS 像素时画采样点（精细档）；
 * - 已播放、已剪去、片段内三种着色全部来自主题令牌。
 */

export type WaveformTier = 'mini' | 'standard'
export type WaveformTone = 'neutral' | 'clip'
export type WaveformRenderMode = 'empty' | 'peaks' | 'samples' | 'points'
export interface WaveformPalette { wave: string; wavePlayed: string; waveCut: string; clipWave: string; line: string; lineStrong: string }

export interface WaveformDrawOptions {
  /** 画布设备像素尺寸。 */
  width: number
  height: number
  pixelRatio: number
  data?: WaveformData
  /** 自上而下的声道（数据中的序号）；默认全部声道。 */
  lanes?: readonly number[]
  /** 绝对时钟采样帧，[startFrame, endFrame)。 */
  startFrame: number
  endFrame: number
  tier: WaveformTier
  tone: WaveformTone
  palette: WaveformPalette
  playedFrame?: number
  cutRanges?: ReadonlyArray<readonly [number, number]>
  detail?: WaveformDetailWindow
}

const OPACITY = { neutral: { peak: 0.45, rms: 1 }, clip: { peak: 0.38, rms: 0.85 } } as const
/** 采样间距达到这么多 CSS 像素时画采样点曲线。 */
const POINT_SPACING_CSS = 2
const STEM_SPACING_CSS = 3
const DOT_SPACING_CSS = 8

type Kind = 'rest' | 'played' | 'cut'
interface Segment { from: number; to: number; kind: Kind }

/** 把 [0, width) 切成互不重叠的着色区段：剪去区段优先，其余按播放位置分为已播放 / 未播放。 */
export function waveformSegments(width: number, startFrame: number, endFrame: number, playedFrame: number | undefined, cutRanges: ReadonlyArray<readonly [number, number]> | undefined): Segment[] {
  const scale = width / Math.max(1e-9, endFrame - startFrame)
  const toX = (frame: number): number => Math.max(0, Math.min(width, (frame - startFrame) * scale))
  const cuts = (cutRanges ?? []).map(([from, to]) => [toX(from), toX(to)] as const).filter(([from, to]) => to > from).sort((a, b) => a[0] - b[0])
  const played = playedFrame === undefined ? 0 : toX(playedFrame)
  const segments: Segment[] = []
  const pushOpen = (from: number, to: number): void => {
    if (to <= from) return
    if (played > from) segments.push({ from, to: Math.min(to, played), kind: 'played' })
    if (played < to) segments.push({ from: Math.max(from, played), to, kind: 'rest' })
  }
  let cursor = 0
  for (const [from, to] of cuts) {
    if (to <= cursor) continue
    pushOpen(cursor, Math.max(cursor, from))
    segments.push({ from: Math.max(cursor, from), to, kind: 'cut' })
    cursor = to
  }
  pushOpen(cursor, width)
  return segments
}

function colorOf(kind: Kind, tone: WaveformTone, palette: WaveformPalette): string {
  if (kind === 'cut') return palette.waveCut
  if (tone === 'clip') return palette.clipWave
  return kind === 'played' ? palette.wavePlayed : palette.wave
}

function traceArea(ctx: CanvasRenderingContext2D, values: Float32Array, gain: number, mid: number, amplitude: number): void {
  const width = values.length
  ctx.beginPath()
  ctx.moveTo(0, mid)
  for (let x = 0; x < width; x++) ctx.lineTo(x + 0.5, mid - Math.min(1, values[x] * gain) * amplitude)
  ctx.lineTo(width, mid)
  for (let x = width - 1; x >= 0; x--) ctx.lineTo(x + 0.5, mid + Math.min(1, values[x] * gain) * amplitude)
  ctx.closePath()
}

function clipTo(ctx: CanvasRenderingContext2D, segments: readonly Segment[], top: number, height: number): void {
  ctx.beginPath()
  for (const segment of segments) ctx.rect(segment.from, top, segment.to - segment.from, height)
  ctx.clip()
}

function groups(segments: readonly Segment[]): Array<[Kind, Segment[]]> {
  const byKind = new Map<Kind, Segment[]>()
  for (const segment of segments) byKind.set(segment.kind, [...(byKind.get(segment.kind) ?? []), segment])
  return [...byKind.entries()]
}

export function drawWaveform(ctx: CanvasRenderingContext2D, options: WaveformDrawOptions): WaveformRenderMode {
  const { width, height, pixelRatio, data, tier, tone, palette, startFrame, endFrame } = options
  ctx.clearRect(0, 0, width, height)
  const pyramid = data?.pyramid
  const lanes = options.lanes ?? (pyramid ? Array.from({ length: pyramid.channelCount }, (_, index) => index) : [0])
  const laneHeight = height / Math.max(1, lanes.length)
  const pad = Math.max(1, pixelRatio)
  const columns = Math.max(1, Math.floor(width))
  const span = endFrame - startFrame
  if (tone === 'neutral') {
    ctx.fillStyle = palette.line
    for (let lane = 0; lane < lanes.length; lane++) ctx.fillRect(0, Math.round(lane * laneHeight + laneHeight / 2 - pixelRatio / 2), width, Math.max(1, Math.round(pixelRatio)))
  }
  if (!pyramid || !data || !(span > 0) || width < 1 || height < 1) return 'empty'
  const framesPerColumn = span / columns
  const baseSamples = pyramid.levels[0].samplesPerBucket
  const detail = options.detail
  const detailCovers = tier === 'standard' && !!detail && framesPerColumn < baseSamples && detail.firstFrame <= startFrame && detail.firstFrame + detail.frameCount >= Math.min(endFrame, pyramid.frameCount)
  const sampleSpacingCss = columns / span / pixelRatio
  const mode: WaveformRenderMode = detailCovers ? (sampleSpacingCss >= POINT_SPACING_CSS ? 'points' : 'samples') : 'peaks'
  const segments = waveformSegments(width, startFrame, endFrame, tone === 'clip' ? undefined : options.playedFrame, options.cutRanges)
  const opacity = OPACITY[tone]
  const peak = new Float32Array(columns)
  const rms = new Float32Array(columns)
  const level = selectWaveformLevel(pyramid.levels, framesPerColumn)
  lanes.forEach((channel, lane) => {
    const top = lane * laneHeight
    const mid = top + laneHeight / 2
    const amplitude = Math.max(0, laneHeight / 2 - pad)
    if (mode === 'points') {
      drawPoints(ctx, options, detail!.channels[channel] ?? detail!.channels[0], detail!.firstFrame, data.gain, top, laneHeight, mid, amplitude, segments, sampleSpacingCss)
      return
    }
    if (mode === 'samples') aggregateWaveformSamples(detail!.channels[channel] ?? detail!.channels[0], detail!.firstFrame, startFrame, endFrame, columns, peak, rms)
    else aggregateWaveformLevel(level, channel, pyramid.amplitudeScale, startFrame, endFrame, columns, peak, rms)
    for (const [kind, parts] of groups(segments)) {
      ctx.save()
      clipTo(ctx, parts, top, laneHeight)
      ctx.fillStyle = colorOf(kind, tone, palette)
      ctx.globalAlpha = opacity.peak
      traceArea(ctx, peak, data.gain, mid, amplitude)
      ctx.fill()
      if (tier === 'standard') {
        ctx.globalAlpha = opacity.rms
        traceArea(ctx, rms, data.gain, mid, amplitude)
        ctx.fill()
      }
      ctx.restore()
    }
  })
  return mode
}

/** 精细档：零线 + 每个采样的竖线 + 采样曲线（间距足够时加采样点）。 */
function drawPoints(ctx: CanvasRenderingContext2D, options: WaveformDrawOptions, samples: Float32Array, firstFrame: number, gain: number, top: number, laneHeight: number, mid: number, amplitude: number, segments: readonly Segment[], spacingCss: number): void {
  const { width, pixelRatio, palette, startFrame, endFrame } = options
  const scale = width / (endFrame - startFrame)
  const first = Math.max(0, Math.floor(startFrame) - firstFrame - 1)
  const last = Math.min(samples.length - 1, Math.ceil(endFrame) - firstFrame + 1)
  const x = (index: number): number => (index + firstFrame - startFrame) * scale
  const y = (index: number): number => mid - Math.max(-1, Math.min(1, samples[index] * gain)) * amplitude
  ctx.save()
  ctx.beginPath(); ctx.rect(0, top, width, laneHeight); ctx.clip()
  ctx.fillStyle = palette.lineStrong
  ctx.fillRect(0, Math.round(mid - pixelRatio / 2), width, Math.max(1, Math.round(pixelRatio)))
  if (spacingCss >= STEM_SPACING_CSS) {
    ctx.strokeStyle = palette.wave
    ctx.globalAlpha = 0.7
    ctx.lineWidth = pixelRatio
    ctx.beginPath()
    for (let index = first; index <= last; index++) { const px = Math.round(x(index)) + 0.5; ctx.moveTo(px, mid); ctx.lineTo(px, y(index)) }
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  ctx.restore()
  for (const [kind, parts] of groups(segments)) {
    ctx.save()
    clipTo(ctx, parts, top, laneHeight)
    const color = kind === 'cut' ? palette.waveCut : palette.wavePlayed
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5 * pixelRatio
    ctx.lineJoin = 'round'
    ctx.beginPath()
    for (let index = first; index <= last; index++) { if (index === first) ctx.moveTo(x(index), y(index)); else ctx.lineTo(x(index), y(index)) }
    ctx.stroke()
    if (spacingCss >= DOT_SPACING_CSS) {
      ctx.fillStyle = color
      ctx.beginPath()
      for (let index = first; index <= last; index++) { ctx.moveTo(x(index) + 1.5 * pixelRatio, y(index)); ctx.arc(x(index), y(index), 1.5 * pixelRatio, 0, Math.PI * 2) }
      ctx.fill()
    }
    ctx.restore()
  }
}
