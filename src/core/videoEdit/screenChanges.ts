/** Pixel work belongs in a Worker. Source times below describe the sampling grid, never decoder PTS. */
export interface ScreenChangeRegion { x: number; y: number; width: number; height: number }
export type ScreenChangeKind = 'change' | 'transient' | 'flash' | 'burst' | 'continuous'
export interface ScreenChange {
  beforeSeconds: number
  atSeconds: number
  lastChangeSeconds: number
  settledSeconds?: number
  returnSeconds?: number
  changedRatio: number
  region: ScreenChangeRegion
  abrupt: boolean
  kind: ScreenChangeKind
}
export interface ScreenChangeOptions {
  width: number; height: number; channels: 1 | 3
  fps: number; startSeconds: number; endSeconds: number
  /** Fraction of pixels whose largest channel delta exceeds pixelDelta. */
  changedRatio?: number; jumpRatio?: number; pixelDelta?: number
}
export interface ScreenChangeScan {
  samplingFps: number; sampledFrames: number; lastSampleSeconds: number | null; candidates: ScreenChange[]
}
const MAX_CANDIDATES = 10000
const MAX_PENDING = 64
const RETURN_SECONDS = 4
const EPSILON = 1e-9

export function screenFrameDifference(a: Uint8Array, b: Uint8Array, width: number, height: number, channels: 1 | 3, pixelDelta = 10): { ratio: number; region: ScreenChangeRegion } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > 512 * 512 || channels !== 1 && channels !== 3
    || a.length !== width * height * channels || b.length !== a.length || !Number.isFinite(pixelDelta) || pixelDelta < 0 || pixelDelta >= 255) throw new Error('局部画面比较的尺寸、通道或像素范围无效。')
  let changed = 0; let left = width; let top = height; let right = -1; let bottom = -1
  for (let pixel = 0; pixel < width * height; pixel++) {
    const offset = pixel * channels
    let different = false
    for (let channel = 0; channel < channels; channel++) if (Math.abs(a[offset + channel] - b[offset + channel]) > pixelDelta) { different = true; break }
    if (!different) continue
    changed++
    const x = pixel % width; const y = Math.floor(pixel / width)
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
  }
  return { ratio: changed / (width * height), region: changed ? { x: left / width, y: top / height, width: (right - left + 1) / width, height: (bottom - top + 1) / height } : { x: 0, y: 0, width: 0, height: 0 } }
}
function union(a: ScreenChangeRegion, b: ScreenChangeRegion): ScreenChangeRegion {
  const x = Math.min(a.x, b.x); const y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}
function overlap(a: ScreenChangeRegion, b: ScreenChangeRegion): number {
  const area = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  const total = a.width * a.height + b.width * b.height - area
  return total > 0 ? area / total : 0
}
function classify(candidates: readonly ScreenChange[]): ScreenChange[] {
  const result = candidates.map(value => ({ ...value, region: { ...value.region } }))
  for (const event of result) {
    event.kind = event.returnSeconds !== undefined ? 'transient' : event.lastChangeSeconds - event.atSeconds >= .6 - EPSILON ? 'continuous' : 'change'
  }
  let run: ScreenChange[] = []
  const flush = (): void => { if (run.length >= 3) for (const event of run) if (event.kind === 'change') event.kind = 'burst' }
  for (const event of result) {
    const previous = run.at(-1)
    if (previous && (event.atSeconds - previous.atSeconds > 3 + EPSILON || overlap(event.region, previous.region) < .7)) { flush(); run = [] }
    run.push(event)
  }
  flush()
  for (let index = 0; index < result.length - 1; index++) {
    const event = result[index]
    if (event.kind === 'change' && event.abrupt && result[index + 1].atSeconds - event.atSeconds <= 1.5 + EPSILON) event.kind = 'flash'
  }
  return result
}

/** Streaming adaptation of FrameFlow's local pixel ratio/return check. Keeps short returns as review candidates. */
export class ScreenChangeAccumulator {
  private readonly options: Required<ScreenChangeOptions>
  private previous?: Uint8Array
  private frameCount = 0
  private closed = false
  private readonly recent: number[] = []
  private readonly candidates: ScreenChange[] = []
  private readonly pending: Array<{ event: ScreenChange; before: Uint8Array; threshold: number }> = []
  private open?: ScreenChange
  constructor(options: ScreenChangeOptions) {
    this.options = { ...options, changedRatio: options.changedRatio ?? .0005, jumpRatio: options.jumpRatio ?? .02, pixelDelta: options.pixelDelta ?? 10 }
    const o = this.options
    if (!Number.isInteger(o.width) || !Number.isInteger(o.height) || o.width <= 0 || o.height <= 0 || o.width * o.height > 512 * 512 || o.channels !== 1 && o.channels !== 3
      || !Number.isFinite(o.fps) || o.fps < 1 || o.fps > 60 || !Number.isFinite(o.startSeconds) || o.startSeconds < 0 || !Number.isFinite(o.endSeconds) || o.endSeconds <= o.startSeconds || o.endSeconds > 86400
      || !Number.isFinite(o.changedRatio) || o.changedRatio <= 0 || o.changedRatio > 1 || !Number.isFinite(o.jumpRatio) || o.jumpRatio < o.changedRatio || o.jumpRatio > 1
      || !Number.isFinite(o.pixelDelta) || o.pixelDelta < 0 || o.pixelDelta >= 255) throw new Error('局部变化分析规格无效：尺寸最多512×512像素，采样1–60fps，源范围不超过24小时。')
  }
  push(frame: Uint8Array): void {
    if (this.closed) throw new Error('局部变化分析已结束。')
    try { this.append(frame) } catch (error) { this.closed = true; this.previous = undefined; this.pending.length = 0; throw error }
  }
  private append(frame: Uint8Array): void {
    const o = this.options; const time = o.startSeconds + this.frameCount / o.fps
    if (frame.length !== o.width * o.height * o.channels) throw new Error('局部变化采样帧不完整。')
    if (time >= o.endSeconds - EPSILON) throw new Error('局部变化采样超出请求范围，未返回截断结果。')
    this.frameCount++
    if (!this.previous) { this.previous = Uint8Array.from(frame); return }
    const diff = screenFrameDifference(frame, this.previous, o.width, o.height, o.channels, o.pixelDelta)
    for (let index = this.pending.length - 1; index >= 0; index--) {
      const entry = this.pending[index]
      if (time - entry.event.atSeconds > RETURN_SECONDS + EPSILON) { this.pending.splice(index, 1); continue }
      if (screenFrameDifference(frame, entry.before, o.width, o.height, o.channels, o.pixelDelta).ratio < entry.threshold) {
        entry.event.returnSeconds = time; this.pending.splice(index, 1)
      }
    }
    if (diff.ratio >= o.changedRatio) {
      if (this.open) {
        this.open.lastChangeSeconds = time; this.open.changedRatio = Math.max(this.open.changedRatio, diff.ratio)
        this.open.region = union(this.open.region, diff.region)
      } else {
        if (this.candidates.length >= MAX_CANDIDATES) throw new Error(`局部变化超过${MAX_CANDIDATES}项，请缩小源范围后分析，未截断候选。`)
        const mean = this.recent.length ? this.recent.reduce((sum, ratio) => sum + ratio, 0) / this.recent.length : 0
        const abrupt = diff.ratio >= o.jumpRatio && mean <= diff.ratio * .3
        const event: ScreenChange = { beforeSeconds: time - 1 / o.fps, atSeconds: time, lastChangeSeconds: time, changedRatio: diff.ratio, region: diff.region, abrupt, kind: 'change' }
        this.candidates.push(event); this.open = event
        if (abrupt) {
          if (this.pending.length >= MAX_PENDING) throw new Error('同时待复核的画面变化超过64项，请缩小范围或降低采样率。')
          this.pending.push({ event, before: this.previous, threshold: diff.ratio * .15 })
        }
      }
    } else if (this.open) { this.open.settledSeconds = time; this.open = undefined }
    this.recent.push(diff.ratio)
    while (this.recent.length > Math.ceil(o.fps)) this.recent.shift()
    this.previous = Uint8Array.from(frame)
  }
  finish(): ScreenChangeScan {
    if (this.closed) throw new Error('局部变化分析已结束。')
    this.closed = true; this.previous = undefined; this.pending.length = 0
    return { samplingFps: this.options.fps, sampledFrames: this.frameCount, lastSampleSeconds: this.frameCount ? this.options.startSeconds + (this.frameCount - 1) / this.options.fps : null, candidates: classify(this.candidates) }
  }
}

/** Plan dense source windows; sparse scanning cannot prove the absence of sub-sample flashes. */
export function planScreenChangeRefinement(candidates: readonly ScreenChange[], startSeconds: number, endSeconds: number,
  budget: { candidates: number; seconds: number } = { candidates: 12, seconds: 60 }): { ranges: Array<{ fromSeconds: number; toSeconds: number }>; omitted: number } {
  if (!Number.isFinite(startSeconds) || startSeconds < 0 || !Number.isFinite(endSeconds) || endSeconds <= startSeconds
    || !Number.isInteger(budget.candidates) || budget.candidates < 1 || budget.candidates > 100 || !Number.isFinite(budget.seconds) || budget.seconds <= 0 || budget.seconds > 600) throw new Error('画面复核范围或预算无效。')
  const priority: Record<ScreenChangeKind, number> = { transient: 0, flash: 1, burst: 2, change: 3, continuous: 4 }
  const ordered = [...candidates].filter(event => event.atSeconds >= startSeconds && event.atSeconds < endSeconds)
    .sort((a, b) => priority[a.kind] - priority[b.kind] || b.changedRatio - a.changedRatio || a.atSeconds - b.atSeconds)
  let ranges: Array<{ fromSeconds: number; toSeconds: number }> = []; let selected = 0
  for (const event of ordered) {
    if (selected >= budget.candidates) break
    const fromSeconds = Math.max(startSeconds, event.beforeSeconds - .2)
    const toSeconds = Math.min(endSeconds, Math.max(event.atSeconds, event.settledSeconds ?? event.lastChangeSeconds, event.returnSeconds ?? event.atSeconds) + .4)
    const merged: typeof ranges = []
    for (const range of [...ranges, { fromSeconds, toSeconds }].sort((a, b) => a.fromSeconds - b.fromSeconds)) {
      const previous = merged.at(-1)
      if (previous && range.fromSeconds <= previous.toSeconds) previous.toSeconds = Math.max(previous.toSeconds, range.toSeconds)
      else merged.push({ ...range })
    }
    if (merged.reduce((seconds, range) => seconds + range.toSeconds - range.fromSeconds, 0) > budget.seconds + EPSILON) continue
    ranges = merged; selected++
  }
  return { ranges, omitted: ordered.length - selected }
}
