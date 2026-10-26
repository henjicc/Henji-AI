import { aggregateWaveformLevel, aggregateWaveformSampleRange, aggregateWaveformSamples, selectWaveformLevel } from '@/core/media/waveformPyramid'
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
  /** 振幅倍数，覆盖数据自带的显示增益；音频编辑按真实电平（1 = 0 dBFS 顶到行高）再乘纵向缩放。超出行高的部分被裁掉。 */
  gain?: number
  /**
   * 层次：`layered`（默认）峰值层半透明 + 响度层实色；`single` 只画一层实色包络，回读到原始采样后按带符号的
   * 最低、最高值画，放大到每列只有一两个采样时画采样曲线（参照 Audition 的波形编辑器）。
   */
  layers?: 'layered' | 'single'
}

/**
 * 每列至少跨这么多个桶。桶比列粗时，列边界压住的半个桶会让包络时胖时瘦：缩放跨级时整段波形一跳、平移时闪。
 * 让每列跨 8 个以上的桶，误差小于一列的 1/8，看起来就是同一条波形在伸缩。
 */
export const WAVEFORM_BUCKETS_PER_COLUMN = 8

/**
 * single 档：每列不超过这么多采样时改画采样曲线。在此之前画带符号的包络（每列连线经过的最低到最高值），
 * 它随放大逐渐收窄成连线的样子，到这里两者覆盖的范围相同，换画法时看不出跳变。
 */
const TRACE_FRAMES_PER_COLUMN = 2
/** 采样曲线的线宽（设备像素 / 像素比）；带符号包络至少这么厚，换画法时粗细一致。 */
const TRACE_LINE_WIDTH = 1.5

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

/** values[i] 是第 i 列；offset 是列网格相对画布左边缘的小数列偏移（列落在固定网格上，见 drawWaveform）。 */
function traceArea(ctx: CanvasRenderingContext2D, values: Float32Array, gain: number, mid: number, amplitude: number, offset = 0): void {
  const count = values.length
  ctx.beginPath()
  ctx.moveTo(-offset, mid)
  for (let x = 0; x < count; x++) ctx.lineTo(x - offset + 0.5, mid - Math.min(1, values[x] * gain) * amplitude)
  ctx.lineTo(count - offset, mid)
  for (let x = count - 1; x >= 0; x--) ctx.lineTo(x - offset + 0.5, mid + Math.min(1, values[x] * gain) * amplitude)
  ctx.closePath()
}

/** 带符号包络：上沿按每列最高值、下沿按最低值；太薄处以中线为准撑到线宽，平的地方也看得见。 */
function traceBand(ctx: CanvasRenderingContext2D, low: Float32Array, high: Float32Array, gain: number, mid: number, amplitude: number, thickness: number, offset = 0): void {
  const count = low.length
  const y = (value: number): number => mid - Math.max(-1, Math.min(1, value * gain)) * amplitude
  const edge = (x: number, upper: boolean): number => {
    const top = y(high[x]), bottom = y(low[x])
    const spread = Math.max(0, thickness - (bottom - top)) / 2
    return upper ? top - spread : bottom + spread
  }
  ctx.beginPath()
  ctx.moveTo(-offset, edge(0, true))
  for (let x = 0; x < count; x++) ctx.lineTo(x - offset + 0.5, edge(x, true))
  ctx.lineTo(count - offset, edge(count - 1, true))
  ctx.lineTo(count - offset, edge(count - 1, false))
  for (let x = count - 1; x >= 0; x--) ctx.lineTo(x - offset + 0.5, edge(x, false))
  ctx.lineTo(-offset, edge(0, false))
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
  const detailCovers = tier === 'standard' && !!detail && framesPerColumn < baseSamples * WAVEFORM_BUCKETS_PER_COLUMN && detail.firstFrame <= startFrame && detail.firstFrame + detail.frameCount >= Math.min(endFrame, pyramid.frameCount)
  const sampleSpacingCss = columns / span / pixelRatio
  const mode: WaveformRenderMode = detailCovers ? (sampleSpacingCss >= POINT_SPACING_CSS ? 'points' : 'samples') : 'peaks'
  const single = options.layers === 'single'
  const segments = waveformSegments(width, startFrame, endFrame, tone === 'clip' ? undefined : options.playedFrame, options.cutRanges)
  const opacity = OPACITY[tone]
  // 列落在以素材起点为原点的固定网格上（按小数列偏移画）：平移时同一列总取同一段数据，波形不闪。
  const phase = startFrame / framesPerColumn - Math.floor(startFrame / framesPerColumn)
  const gridStart = startFrame - phase * framesPerColumn
  const gridColumns = columns + 1
  const gridEnd = gridStart + gridColumns * framesPerColumn
  const peak = new Float32Array(gridColumns)
  const rms = new Float32Array(gridColumns)
  const level = selectWaveformLevel(pyramid.levels, framesPerColumn / WAVEFORM_BUCKETS_PER_COLUMN)
  const gain = options.gain ?? data.gain
  lanes.forEach((channel, lane) => {
    const top = lane * laneHeight
    const mid = top + laneHeight / 2
    const amplitude = Math.max(0, laneHeight / 2 - pad)
    if (mode === 'points' || (single && mode === 'samples' && framesPerColumn <= TRACE_FRAMES_PER_COLUMN)) {
      drawPoints(ctx, options, detail!.channels[channel] ?? detail!.channels[0], detail!.firstFrame, gain, top, laneHeight, mid, amplitude, segments, sampleSpacingCss)
      return
    }
    // single 档用带符号的范围（peak 存最高、rms 存最低）；layered 档仍是对称峰值 + 响度。
    const signed = single && mode === 'samples'
    if (signed) aggregateWaveformSampleRange(detail!.channels[channel] ?? detail!.channels[0], detail!.firstFrame, gridStart, gridEnd, gridColumns, rms, peak)
    else if (mode === 'samples') aggregateWaveformSamples(detail!.channels[channel] ?? detail!.channels[0], detail!.firstFrame, gridStart, gridEnd, gridColumns, peak, rms)
    else aggregateWaveformLevel(level, channel, pyramid.amplitudeScale, gridStart, gridEnd, gridColumns, peak, rms)
    for (const [kind, parts] of groups(segments)) {
      ctx.save()
      clipTo(ctx, parts, top, laneHeight)
      ctx.fillStyle = colorOf(kind, tone, palette)
      ctx.globalAlpha = single ? 1 : opacity.peak
      if (signed) traceBand(ctx, rms, peak, gain, mid, amplitude, TRACE_LINE_WIDTH * pixelRatio, phase)
      else traceArea(ctx, peak, gain, mid, amplitude, phase)
      ctx.fill()
      if (tier === 'standard' && !single) {
        ctx.globalAlpha = opacity.rms
        traceArea(ctx, rms, gain, mid, amplitude, phase)
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
    ctx.lineWidth = TRACE_LINE_WIDTH * pixelRatio
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
