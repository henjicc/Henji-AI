import { createLogger } from '@/core/logging'
import type { FilmstripHeight } from '@/core/media/filmstripFrames'
import { getPlatform } from '@/platform/runtime'
import { resolveImageDisplayUrl } from '@/services/imageSource'

/**
 * 渲染层片段缩略帧的唯一来源（任务 2.4）：按“素材 + 时间点 + 高度档”向主进程要磁盘缓存中的帧，
 * 解码完成后才算就绪（换图不闪）；请求并发受限、首帧优先，无人使用即取消；就绪的帧按“素材 + 高度”建索引，
 * 缩放后新时间点还没到时，显示同一素材最接近的已就绪帧，不出现空白。
 */

export interface FilmstripFrameRef {
  /** 本地素材路径。 */
  source: string
  sourceRevision?: string
  timeUs: number
  height: FilmstripHeight
}
/** 首帧（片段第一格）先于其余帧请求。 */
export type FilmstripFramePriority = 'first' | 'normal'

type Status = 'queued' | 'loading' | 'ready' | 'failed'
interface Entry {
  key: string
  series: string
  ref: FilmstripFrameRef
  status: Status
  url?: string
  users: number
  priority: FilmstripFramePriority
  lastUsed: number
  queued: boolean
  controller?: AbortController
}

const logger = createLogger('services.videoFilmstrip')
/** 同时在途的请求：主进程每批 8 帧、2 个进程，再留出命中缓存的余量。 */
const MAX_IN_FLIGHT = 24
const MAX_ENTRIES = 6000
const NOTIFY_MS = 16

const entries = new Map<string, Entry>()
/** 素材 + 高度 → 已就绪帧（按时间）。 */
const readySeries = new Map<string, ReadySeries>()
/** 一组已就绪帧：按时间升序的数组供二分查找最近帧，Map 供取地址。 */
interface ReadySeries { times: number[]; urls: Map<number, string> }
const queue: Entry[] = []
const listeners = new Set<() => void>()
const reportedSources = new Set<string>()
let inFlight = 0
let revision = 0
let notifyTimer: ReturnType<typeof setTimeout> | undefined
/** Bumped by the test reset so stale requests do not touch the in-flight count. */
let generation = 0

function notifySoon(): void {
  if (notifyTimer) return
  notifyTimer = setTimeout(() => {
    notifyTimer = undefined
    revision++
    for (const listener of [...listeners]) listener()
  }, NOTIFY_MS)
}
export function subscribeFilmstripFrames(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function filmstripFramesRevision(): number { return revision }

// Keys are built on every timeline render (each visible tile, each scroll or zoom step): plain concatenation, no JSON.
function seriesKey(ref: FilmstripFrameRef): string { return `${ref.height}\n${ref.sourceRevision ?? ''}\n${ref.source}` }
export function filmstripFrameKey(ref: FilmstripFrameRef): string { return `${ref.timeUs}\n${seriesKey(ref)}` }

/** 该帧已解码就绪时的显示地址。 */
export function readFilmstripFrame(ref: FilmstripFrameRef): string | undefined {
  const entry = entries.get(filmstripFrameKey(ref))
  return entry?.status === 'ready' ? entry.url : undefined
}
/** 同一素材、同一高度里时间最接近的已就绪帧（不早于它的优先取更早的那帧，与“这一格从此刻开始”一致）。 */
export function nearestFilmstripFrame(ref: FilmstripFrameRef): string | undefined {
  const series = readySeries.get(seriesKey(ref))
  if (!series?.times.length) return undefined
  const { times } = series
  // Last time at or before the wanted one; the first one when every ready frame is later.
  let low = 0; let high = times.length
  while (low < high) { const middle = (low + high) >> 1; if (times[middle] <= ref.timeUs) low = middle + 1; else high = middle }
  return series.urls.get(times[Math.max(0, low - 1)])
}

const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError'

async function decoded(url: string): Promise<void> {
  if (typeof Image === 'undefined') return
  const image = new Image()
  image.decoding = 'async'
  image.src = url
  // Decode before publishing so swapping the tile's src never shows an empty frame.
  if (typeof image.decode === 'function') await image.decode()
}

function markReady(entry: Entry, url: string): void {
  entry.status = 'ready'
  entry.url = url
  let series = readySeries.get(entry.series)
  if (!series) { series = { times: [], urls: new Map() }; readySeries.set(entry.series, series) }
  if (!series.urls.has(entry.ref.timeUs)) {
    const { times } = series
    let index = times.length
    while (index > 0 && times[index - 1] > entry.ref.timeUs) index--
    times.splice(index, 0, entry.ref.timeUs)
  }
  series.urls.set(entry.ref.timeUs, url)
  notifySoon()
}
function forget(entry: Entry): void {
  entries.delete(entry.key)
  const series = readySeries.get(entry.series)
  if (series && entry.url && series.urls.get(entry.ref.timeUs) === entry.url) {
    series.urls.delete(entry.ref.timeUs)
    series.times.splice(series.times.indexOf(entry.ref.timeUs), 1)
    if (!series.times.length) readySeries.delete(entry.series)
  }
}

async function load(entry: Entry): Promise<void> {
  const controller = new AbortController()
  entry.controller = controller
  entry.status = 'loading'
  inFlight++
  const owner = generation
  try {
    const result = await getPlatform().video.getFilmstripFrame({ source: entry.ref.source, timeUs: entry.ref.timeUs, height: entry.ref.height }, controller.signal)
    const url = resolveImageDisplayUrl(result.path)
    await decoded(url)
    if (entries.get(entry.key) !== entry || controller.signal.aborted) return
    markReady(entry, url)
  } catch (error) {
    if (entries.get(entry.key) !== entry || controller.signal.aborted || isAbort(error)) return
    entry.status = 'failed'
    // One report per source: a missing or unreadable file fails every tile of it.
    if (!reportedSources.has(entry.ref.source)) {
      reportedSources.add(entry.ref.source)
      logger.warn('片段缩略帧未能生成，片段只显示底色', { event: 'video_edit.filmstrip.frame_failed', source: entry.ref.source, error })
    }
  } finally {
    if (entry.controller === controller) entry.controller = undefined
    if (owner === generation) { inFlight--; pump() }
  }
}

function pump(): void {
  while (inFlight < MAX_IN_FLIGHT && queue.length) {
    const index = queue.findIndex(entry => entry.priority === 'first')
    const [entry] = queue.splice(index >= 0 ? index : 0, 1)
    entry.queued = false
    if (entry.users === 0 || entries.get(entry.key) !== entry || entry.status !== 'queued') continue
    void load(entry)
  }
}

function evict(): void {
  if (entries.size <= MAX_ENTRIES) return
  const idle = [...entries.values()].filter(entry => entry.users === 0).sort((a, b) => a.lastUsed - b.lastUsed)
  for (const entry of idle) {
    if (entries.size <= MAX_ENTRIES * 0.8) break
    forget(entry)
  }
}

/** 声明一组帧正在显示：未就绪的排队加载；返回释放函数，无人使用的在途请求被取消。 */
export function acquireFilmstripFrames(refs: readonly FilmstripFrameRef[], priority: (ref: FilmstripFrameRef, index: number) => FilmstripFramePriority = () => 'normal'): () => void {
  const now = Date.now()
  const held: Entry[] = []
  refs.forEach((ref, index) => {
    const key = filmstripFrameKey(ref)
    let entry = entries.get(key)
    if (!entry) {
      entry = { key, series: seriesKey(ref), ref, status: 'queued', users: 0, priority: priority(ref, index), lastUsed: now, queued: false }
      entries.set(key, entry)
    }
    if (entry.status === 'queued' && !entry.queued) { entry.queued = true; queue.push(entry) }
    if (priority(ref, index) === 'first') entry.priority = 'first'
    entry.users++
    entry.lastUsed = now
    held.push(entry)
  })
  pump()
  evict()
  let released = false
  return () => {
    if (released) return
    released = true
    const at = Date.now()
    for (const entry of held) {
      entry.users--
      entry.lastUsed = at
      if (entry.users > 0) continue
      if (entry.queued) { const index = queue.indexOf(entry); if (index >= 0) queue.splice(index, 1); entry.queued = false }
      if (entry.status === 'loading') {
        entry.controller?.abort(new DOMException('缩略帧已无使用者', 'AbortError'))
        entry.controller = undefined
        entry.status = 'queued'
      }
    }
    evict()
  }
}

/** 仅供测试与诊断：在途、排队与就绪的数量。 */
export function filmstripFrameStatistics(): { inFlight: number; queued: number; ready: number; failed: number } {
  let ready = 0; let failed = 0
  for (const entry of entries.values()) { if (entry.status === 'ready') ready++; else if (entry.status === 'failed') failed++ }
  return { inFlight, queued: queue.length, ready, failed }
}

/** 仅供测试：清空会话缓存。 */
export function resetFilmstripFramesForTests(): void {
  for (const entry of entries.values()) entry.controller?.abort(new DOMException('重置', 'AbortError'))
  entries.clear(); readySeries.clear(); queue.length = 0; reportedSources.clear(); inFlight = 0; generation++
  if (notifyTimer) { clearTimeout(notifyTimer); notifyTimer = undefined }
  revision++
  for (const listener of [...listeners]) listener()
}
