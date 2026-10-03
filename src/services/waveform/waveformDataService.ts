import { getPlatform } from '@/platform/runtime'
import { createLogger } from '@/core/logging'
import type { AudioWaveformPyramid } from '@/platform/contracts/audioWaveform'
import { WAVEFORM_DETAIL_MAX_FRAMES, audioWaveformSampleIndex } from '@/core/media/waveformPyramid'

/**
 * 渲染层波形数据的唯一来源（任务 2.3）：按“素材 + 声音流 + 声道选择”向主进程取整段多级峰值，
 * 会话内按字节上限缓存、并发受限、无人使用即取消；精细档（比第 0 级更细）按窗口回读原始采样。
 * 主进程负责解码与磁盘缓存，这里只持有已解码的定点数组。
 */

const logger = createLogger('services.waveform')

export interface WaveformSourceRef {
  /** 本地路径、henji-media 地址或网络音频地址。 */
  source: string
  sourceRevision?: string
  channels: 1 | 2
  audioStream?: number
  audioChannel?: number
}
/** overview：只取不超过约 1.6 万桶的级（缩略、播放器）；full：全部级（可缩放的时间线）。 */
export type WaveformScope = 'overview' | 'full'

export interface WaveformData {
  key: string
  ref: WaveformSourceRef
  pyramid: AudioWaveformPyramid
  /** 统一归一化：同一素材在任何位置、任何缩放下使用同一增益（全段最大峰值 → 满幅）。 */
  gain: number
}
export interface WaveformState { status: 'idle' | 'loading' | 'ready' | 'error'; data?: WaveformData; error?: string }
export interface WaveformDetailWindow { key: string; firstFrame: number; frameCount: number; channels: Float32Array[] }

export const WAVEFORM_OVERVIEW_MAX_BUCKETS = 16384
/** 归一化增益上限：极安静的素材最多放大到 -36 dB 满幅，避免把底噪画成满屏。 */
const DISPLAY_FLOOR = 1 / 64
const BUDGET_BYTES = 128 * 1024 * 1024
const MAX_IN_FLIGHT = 4
const REVALIDATE_MS = 10_000
const DETAIL_ALIGN = 4096
const DETAIL_ENTRIES = 12

interface Entry {
  key: string
  ref: WaveformSourceRef
  scope: WaveformScope
  state: WaveformState
  users: number
  bytes: number
  lastUsed: number
  validatedAt: number
  controller?: AbortController
  queued: boolean
}
interface DetailEntry { key: string; users: number; lastUsed: number; window?: WaveformDetailWindow; controller?: AbortController; failed?: boolean }

const IDLE: WaveformState = Object.freeze({ status: 'idle' })
const entries = new Map<string, Entry>()
const details = new Map<string, DetailEntry>()
const waiting: Entry[] = []
const listeners = new Set<() => void>()
let inFlight = 0
let revision = 0
/** Bumped by the test reset so stale requests do not touch the in-flight count. */
let generation = 0

function notify(): void {
  revision++
  for (const listener of [...listeners]) listener()
}
export function subscribeWaveformData(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function waveformDataRevision(): number { return revision }

function normalizedRef(ref: WaveformSourceRef): WaveformSourceRef {
  return {
    source: ref.source,
    ...(ref.sourceRevision ? { sourceRevision: ref.sourceRevision } : {}),
    channels: ref.audioChannel !== undefined ? 1 : ref.channels,
    ...(ref.audioStream ? { audioStream: ref.audioStream } : {}),
    ...(ref.audioChannel !== undefined ? { audioChannel: ref.audioChannel } : {}),
  }
}
export function waveformKey(ref: WaveformSourceRef, scope: WaveformScope): string {
  const value = normalizedRef(ref)
  return JSON.stringify([scope, value.source, value.sourceRevision ?? null, value.channels, value.audioStream ?? 0, value.audioChannel ?? null])
}

function byteSize(pyramid: AudioWaveformPyramid): number {
  return pyramid.levels.reduce((sum, level) => sum + level.bucketCount * pyramid.channelCount * 4, 512)
}
function toData(entry: Entry, pyramid: AudioWaveformPyramid): WaveformData {
  return { key: entry.key, ref: entry.ref, pyramid, gain: 1 / Math.max(pyramid.peakMax, DISPLAY_FLOOR) }
}
function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '波形未能读取，请重新导入原素材。'
}
const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError'

function evict(): void {
  let total = 0
  for (const entry of entries.values()) total += entry.bytes
  if (total <= BUDGET_BYTES) return
  const idle = [...entries.values()].filter((entry) => entry.users === 0).sort((a, b) => a.lastUsed - b.lastUsed)
  for (const entry of idle) {
    if (total <= BUDGET_BYTES) break
    entries.delete(entry.key); total -= entry.bytes
  }
}

async function fetchEntry(entry: Entry, revalidate: boolean): Promise<void> {
  const controller = new AbortController()
  entry.controller = controller
  inFlight++
  const owner = generation
  const held = revalidate ? entry.state.data : undefined
  try {
    const request = { ...normalizedRef(entry.ref), ...(entry.scope === 'overview' ? { maxBuckets: WAVEFORM_OVERVIEW_MAX_BUCKETS } : {}), ...(held ? { ifNoneMatch: held.pyramid.version } : {}) }
    const result = await getPlatform().audioEdit.extractWaveformPyramid(request, controller.signal)
    if (entries.get(entry.key) !== entry || controller.signal.aborted) return
    entry.validatedAt = Date.now()
    if ('notModified' in result) return
    entry.bytes = byteSize(result)
    entry.state = { status: 'ready', data: toData(entry, result) }
    notify()
    evict()
  } catch (error) {
    // Our own cancellation already reset the entry (and a new user may have restarted it).
    if (entries.get(entry.key) !== entry || controller.signal.aborted) return
    // A failed revalidation keeps the shown waveform; a failed first load reports why.
    if (held) { logger.warn('波形重新校验失败，保留已有波形', { data: [entry.ref.source, error] }); return }
    entry.state = { status: 'error', error: errorMessage(error) }
    notify()
  } finally {
    if (entry.controller === controller) entry.controller = undefined
    if (owner === generation) { inFlight--; pump() }
  }
}

function pump(): void {
  while (inFlight < MAX_IN_FLIGHT && waiting.length) {
    const entry = waiting.shift()!
    entry.queued = false
    if (entry.users === 0 || entries.get(entry.key) !== entry) continue
    void fetchEntry(entry, entry.state.status === 'ready')
  }
}
function schedule(entry: Entry): void {
  if (entry.queued || entry.controller) return
  entry.queued = true
  waiting.push(entry)
  pump()
}

/** 读取当前状态：overview 请求在同一素材的 full 数据已就绪时直接用 full。 */
export function readWaveformState(ref: WaveformSourceRef, scope: WaveformScope): WaveformState {
  if (scope === 'overview') {
    const full = entries.get(waveformKey(ref, 'full'))
    if (full?.state.status === 'ready') return full.state
  }
  return entries.get(waveformKey(ref, scope))?.state ?? IDLE
}

/** 声明使用：首次使用开始加载、过期就后台校验；返回释放函数，无人使用时取消在途请求。 */
export function acquireWaveform(ref: WaveformSourceRef, scope: WaveformScope): () => void {
  if (scope === 'overview' && entries.get(waveformKey(ref, 'full'))?.state.status === 'ready') scope = 'full'
  const key = waveformKey(ref, scope)
  let entry = entries.get(key)
  if (!entry) {
    entry = { key, ref: normalizedRef(ref), scope, state: IDLE, users: 0, bytes: 0, lastUsed: Date.now(), validatedAt: 0, queued: false }
    entries.set(key, entry)
  }
  const owned = entry
  owned.users++
  owned.lastUsed = Date.now()
  if (owned.state.status === 'idle') { owned.state = { status: 'loading' }; notify(); schedule(owned) }
  // Local files are revalidated by content version; network audio has no cheap version check and is not refetched.
  else if (owned.state.status === 'ready' && !/^https?:\/\//.test(owned.ref.source) && Date.now() - owned.validatedAt > REVALIDATE_MS) schedule(owned)
  let released = false
  return () => {
    if (released) return
    released = true
    owned.users--
    owned.lastUsed = Date.now()
    if (owned.users > 0) return
    if (owned.queued) { const index = waiting.indexOf(owned); if (index >= 0) waiting.splice(index, 1); owned.queued = false }
    owned.controller?.abort(new DOMException('波形已无使用者', 'AbortError'))
    owned.controller = undefined
    if (owned.state.status === 'loading') { owned.state = IDLE; notify() }
    evict()
  }
}

/** 精细档窗口：比视图宽约 3 倍、按 4096 帧对齐，便于平移时复用；超过回读上限时返回 undefined。 */
export function planWaveformDetailWindow(frameCount: number, startFrame: number, endFrame: number): { start: number; end: number } | undefined {
  const span = endFrame - startFrame
  const limit = WAVEFORM_DETAIL_MAX_FRAMES - 2 * DETAIL_ALIGN
  if (!(span > 0) || span > limit) return undefined
  const want = Math.min(limit, Math.max(span * 3, 4 * DETAIL_ALIGN))
  const center = (startFrame + endFrame) / 2
  const start = Math.max(0, Math.floor((center - want / 2) / DETAIL_ALIGN) * DETAIL_ALIGN)
  const end = Math.min(frameCount, Math.ceil((center + want / 2) / DETAIL_ALIGN) * DETAIL_ALIGN)
  return end > start ? { start, end } : undefined
}

export function readWaveformDetail(key: string): WaveformDetailWindow | undefined {
  return details.get(key)?.window
}
export function waveformDetailKey(data: WaveformData, start: number, end: number): string {
  return `${data.key}|${data.pyramid.version}|${start}|${end}`
}

/** 回读 [start, end) 帧的原始带符号采样（主进程区间解码，按样本精确对齐）。 */
export function acquireWaveformDetail(data: WaveformData, start: number, end: number): () => void {
  const key = waveformDetailKey(data, start, end)
  let entry = details.get(key)
  if (!entry) {
    entry = { key, users: 0, lastUsed: Date.now() }
    details.set(key, entry)
  }
  const owned = entry
  owned.users++
  owned.lastUsed = Date.now()
  if (!owned.window && !owned.controller && !owned.failed) {
    const controller = new AbortController()
    owned.controller = controller
    const { sampleRate } = data.pyramid
    const ref = normalizedRef(data.ref)
    const startUs = Math.floor(start * 1_000_000 / sampleRate)
    const endUs = Math.floor(end * 1_000_000 / sampleRate)
    void getPlatform().audioEdit.extractWaveformRange({ ...ref, startUs, endUs, bucketCount: 16, samples: true }, controller.signal).then((result) => {
      if (details.get(key) !== owned || controller.signal.aborted) return
      const channels = result.channels.map((channel) => channel.samples).filter((samples): samples is Float32Array => samples instanceof Float32Array)
      if (channels.length !== result.channels.length || !channels.length) { owned.failed = true; return }
      owned.window = { key, firstFrame: audioWaveformSampleIndex(result.startUs, result.sampleRate), frameCount: channels[0].length, channels }
      notify()
    }, (error: unknown) => {
      if (details.get(key) !== owned || controller.signal.aborted || isAbort(error)) return
      owned.failed = true
      logger.warn('精细波形回读失败，保留多级峰值显示', { data: [data.ref.source, error] })
    }).finally(() => { if (owned.controller === controller) owned.controller = undefined })
  }
  let released = false
  return () => {
    if (released) return
    released = true
    owned.users--
    owned.lastUsed = Date.now()
    if (owned.users > 0) return
    if (owned.controller && !owned.window) { owned.controller.abort(new DOMException('波形已无使用者', 'AbortError')); owned.controller = undefined; details.delete(key) }
    const idle = [...details.values()].filter((item) => item.users === 0).sort((a, b) => a.lastUsed - b.lastUsed)
    while (details.size > DETAIL_ENTRIES && idle.length) details.delete(idle.shift()!.key)
  }
}

/** 仅供测试：清空会话缓存。 */
export function resetWaveformDataForTests(): void {
  for (const entry of entries.values()) entry.controller?.abort(new DOMException('重置', 'AbortError'))
  for (const entry of details.values()) entry.controller?.abort(new DOMException('重置', 'AbortError'))
  entries.clear(); details.clear(); waiting.length = 0; inFlight = 0; generation++
  notify()
}
