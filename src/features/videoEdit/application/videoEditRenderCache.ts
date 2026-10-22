import { CanvasSource, Mp4OutputFormat, Output, StreamTarget } from 'mediabunny'
import { z } from 'zod'
import { videoEditRenderWindows, type VideoEditRenderWindow } from '@/core/videoEdit/renderCache'
import { videoEditRenderEncoding, type VideoEditRenderEncoding } from '@/core/videoEdit/renderBitrate'
import type { VideoRenderCacheStoredEntry } from '@/core/videoEdit/renderCacheStore'
import { getMediaCacheSettings, subscribeMediaCacheSettings } from '@/services/mediaCache/mediaCacheSettings'
import { resolveRenderCacheCodec } from '@/services/mediaCache/hardwareCapabilities'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import { createLogger } from '@/core/logging'
import { getPlatform } from '@/platform/runtime'
import { fontLibrarySnapshot } from '@/platform/fonts'
import { VideoEditRenderSession } from '../engine/videoEditRenderSession'
import { videoEditExportVideoOptions } from '../engine/videoEditExportEncoder'
import { findActiveVideoEditSequence, getActiveVideoEditSequence, listVideoEditInstances, publishVideoEdit, requireVideoEditInstance, type VideoEditInstance } from './videoEditService'
import { videoEditTrackResults, waitVideoEditTracking } from './videoEditTracking'
import { videoEditSmartRegionSegments, waitVideoEditSmartRegions } from './videoEditSmartRegions'

/**
 * 预渲染（PR“渲染入点到出点”与渲染条）：吃力的窗口在后台渲染成预览文件，节目正向播放时整帧取自文件。
 * 文件由主进程放进作品目录缓存（统一受缓存管理的容量上限与保留天数约束），按窗口内容指纹与编码档案寻址；
 * 参数、源码、素材任一依赖改变只让受影响窗口失效，预渲染格式或画质改变时按新档案重做。
 * 暂停画面、拖动、观察与导出始终实时合成，不读预览文件。
 */
const logger = createLogger('features.videoEdit.renderCache')
/** 自动预渲染：编辑停下这么久、且没有播放、拖动或导出时才开始。 */
const AUTO_RENDER_IDLE_MS = 3000
const AUTO_RENDER_RETRY_MS = 30_000

export interface VideoEditRenderPreference { autoRender: boolean }
const preferenceSchema = z.object({ autoRender: z.boolean() }).strict()
const preferences = new Map<string, VideoEditRenderPreference>()
/** 预渲染偏好，本机按剪辑记住；默认自动渲染。 */
export function getVideoEditRenderPreference(projectId: string): VideoEditRenderPreference {
  let value = preferences.get(projectId)
  if (!value) {
    try { value = preferenceSchema.parse(JSON.parse(localStorage.getItem(`videoEdit.renderPreference.${projectId}`) ?? 'null')) } catch { value = { autoRender: true } }
    preferences.set(projectId, value)
  }
  return { ...value }
}
export function setVideoEditRenderPreference(projectId: string, next: VideoEditRenderPreference): void {
  requireVideoEditInstance(projectId)
  const value = preferenceSchema.parse(next)
  preferences.set(projectId, value)
  try { localStorage.setItem(`videoEdit.renderPreference.${projectId}`, JSON.stringify(value)) } catch (error) { logger.warn('预渲染偏好未保存', { event: 'video_edit.render_cache.preference_failed', error }) }
  if (!value.autoRender) for (const instance of listVideoEditInstances()) if (instance.document.id === projectId) autoState.get(instance)?.controller?.abort(new DOMException('已关闭自动预渲染。', 'AbortError'))
  publishVideoEdit()
}

type Entry = VideoRenderCacheStoredEntry
/** 每个剪辑已完成的预览文件，按窗口指纹索引（同一窗口只留当前档案的一份）。 */
interface ProjectCache { entries: Map<string, Entry> }
const caches = new Map<string, Promise<ProjectCache>>()

/** 序列的编码档案：编码格式（自动时按本机硬件）、画质与按分辨率帧率计算的码率。 */
export function videoEditRenderProfile(composition: Pick<VideoEditComposition, 'width' | 'height' | 'fps'>): VideoEditRenderEncoding {
  const settings = getMediaCacheSettings()
  return videoEditRenderEncoding(composition, resolveRenderCacheCodec(settings.renderFormat), settings.renderQuality)
}
// Format or quality changes make other profiles stale: the render bar and the idle scheduler pick it up.
subscribeMediaCacheSettings(() => publishVideoEdit())
interface Job { sequenceId: string; controller: AbortController; total: number; done: number; current?: string; auto: boolean }
/** Per open project: the content an automatic render belongs to and when it last changed. */
const autoState = new WeakMap<VideoEditInstance, { content: string; changedAt: number; controller?: AbortController }>()
let autoTimer: ReturnType<typeof setInterval> | undefined
/** Starts watching open projects for idle time (once, when a program monitor first reads its cache). */
function ensureAutoRender(): void {
  if (autoTimer) return
  autoTimer = setInterval(() => {
    const now = performance.now()
    for (const instance of listVideoEditInstances()) {
      const projectId = instance.document.id
      const content = `${instance.activeSequenceId}\u0000${instance.document.revision}`
      let state = autoState.get(instance)
      if (!state) { state = { content, changedAt: now }; autoState.set(instance, state) }
      // An edit makes windows rendered from the old content useless: stop the automatic job and wait for quiet again.
      if (state.content !== content) { state.content = content; state.changedAt = now; state.controller?.abort(new DOMException('剪辑内容已改变。', 'AbortError')) }
      if (!getVideoEditRenderPreference(projectId).autoRender || !loaded.has(projectId) || jobs.get(instance) || !instance.activeSequenceId) continue
      if (instance.playing || instance.scrubbing || instance.busy || now - state.changedAt < AUTO_RENDER_IDLE_MS) continue
      let view: VideoEditRenderCacheView
      try { view = readVideoEditRenderCache(projectId) } catch { continue }
      if (!view.needsRenderFrames) continue
      const controller = new AbortController(); state.controller = controller
      void renderVideoEditRenderCache(projectId, { scope: 'needed', aroundFrame: instance.frame, auto: true }, controller.signal)
        .catch(error => {
          if (controller.signal.aborted) return
          // A failing render (missing media, device lost) waits half a minute instead of retrying every tick.
          state!.changedAt = performance.now() + AUTO_RENDER_RETRY_MS - AUTO_RENDER_IDLE_MS
          logger.warn('自动预渲染未完成，稍后重试', { event: 'video_edit.render_cache.auto_failed', error, context: { projectId } })
        })
    }
    if (!listVideoEditInstances().length) { clearInterval(autoTimer); autoTimer = undefined }
  }, 1000)
}
const jobs = new WeakMap<VideoEditInstance, Job>()

export type VideoEditRenderWindowState = 'ready' | 'rendering' | 'needs_render' | 'realtime'
export interface VideoEditRenderCacheView {
  windows: Array<{ startFrame: number; endFrame: number; state: VideoEditRenderWindowState }>
  readyFrames: number; needsRenderFrames: number; totalFrames: number
  rendering: { done: number; total: number } | null
}

function cacheOf(projectId: string): Promise<ProjectCache> {
  let pending = caches.get(projectId)
  if (!pending) {
    pending = (async () => {
      const entries = new Map<string, Entry>()
      for (const entry of await getPlatform().mediaCache.renderList(projectId)) entries.set(entry.windowKey, entry)
      // Sequences deleted since the files were written are never played again.
      const instance = listVideoEditInstances().find(value => value.document.id === projectId)
      if (instance) void getPlatform().mediaCache.renderRemove({ projectId, keepSequenceIds: instance.document.sequences.map(sequence => sequence.id) })
        .then(removed => { if (removed) for (const [key, entry] of entries) if (!instance.document.sequences.some(sequence => sequence.id === entry.sequenceId)) entries.delete(key) })
        .catch(error => logger.warn('已删除序列的预渲染文件未回收', { event: 'video_edit.render_cache.prune_failed', error, context: { projectId } }))
      return { entries }
    })()
    pending.catch(() => caches.delete(projectId))
    caches.set(projectId, pending)
  }
  return pending
}
/** A file counts only when it was rendered for this window with the current profile. */
function readyEntry(cache: ProjectCache | undefined, window: VideoEditRenderWindow, profile: string): Entry | undefined {
  const entry = cache?.entries.get(window.key)
  return entry && entry.profile === profile && entry.startFrame === window.startFrame && entry.endFrame === window.endFrame ? entry : undefined
}

const windowMemo = new WeakMap<VideoEditComposition, { dependencies: string; windows: VideoEditRenderWindow[] }>()
/** 当前序列的窗口与指纹；同一文档快照与依赖只算一次。 */
export function videoEditRenderCacheWindows(composition: VideoEditComposition): VideoEditRenderWindow[] {
  const dependencies = { fontRevision: fontLibrarySnapshot().revision, analysis: JSON.stringify([videoEditTrackResults(), videoEditSmartRegionSegments()]) }
  const signature = JSON.stringify(dependencies)
  const memo = windowMemo.get(composition)
  if (memo?.dependencies === signature) return memo.windows
  const windows = videoEditRenderWindows(composition, dependencies)
  windowMemo.set(composition, { dependencies: signature, windows })
  return windows
}

const loaded = new Map<string, ProjectCache>()
/** 已加载的项目缓存（同步读取用）；节目监视器打开时触发加载，完成后通知界面。 */
function loadedCache(projectId: string, load = false): ProjectCache | undefined {
  const cache = loaded.get(projectId)
  if (load) ensureAutoRender()
  if (!cache && load) void cacheOf(projectId).then(value => { if (!loaded.has(projectId)) { loaded.set(projectId, value); publishVideoEdit() } }, error => logger.warn('预渲染缓存读取失败', { event: 'video_edit.render_cache.load_failed', error, context: { projectId } }))
  return cache
}

/** 节目当前序列已就绪的预渲染窗口（本地文件）；指纹不匹配的旧文件不会被播放。 */
export function readyVideoEditRenderWindows(projectId: string, composition: VideoEditComposition): Array<{ key: string; startFrame: number; endFrame: number; path: string; width: number; height: number; fps: number }> {
  const cache = loadedCache(projectId, true)
  if (!cache) return []
  const { profile } = videoEditRenderProfile(composition)
  return videoEditRenderCacheWindows(composition).flatMap(window => {
    const entry = readyEntry(cache, window, profile)
    return entry ? [{ key: entry.windowKey, startFrame: entry.startFrame, endFrame: entry.endFrame, path: entry.path, width: entry.width, height: entry.height, fps: entry.fps }] : []
  })
}

/** 渲染条的状态：已渲染、正在渲染、需要渲染（吃力且未渲染）、实时。 */
export function readVideoEditRenderCache(projectId: string, sequenceId?: string): VideoEditRenderCacheView {
  const instance = requireVideoEditInstance(projectId)
  // An empty project has nothing to render.
  const composition = findActiveVideoEditSequence(instance)
  if (!composition) return { windows: [], readyFrames: 0, needsRenderFrames: 0, totalFrames: 0, rendering: null }
  if (sequenceId && sequenceId !== composition.id) throw new Error('只能读取当前序列的渲染状态，请先切换到该序列。')
  const cache = loadedCache(projectId)
  const job = jobs.get(instance)
  const { profile } = videoEditRenderProfile(composition)
  const windows = videoEditRenderCacheWindows(composition).map(window => ({ startFrame: window.startFrame, endFrame: window.endFrame,
    state: readyEntry(cache, window, profile) ? 'ready' as const : job?.current === window.key ? 'rendering' as const : window.heavy ? 'needs_render' as const : 'realtime' as const }))
  const frames = (state: VideoEditRenderWindowState): number => windows.filter(window => window.state === state).reduce((sum, window) => sum + window.endFrame - window.startFrame, 0)
  return { windows, readyFrames: frames('ready'), needsRenderFrames: frames('needs_render'), totalFrames: windows.at(-1)?.endFrame ?? 0, rendering: job && job.sequenceId === composition.id ? { done: job.done, total: job.total } : null }
}

export function cancelVideoEditRenderCache(projectId: string): void { jobs.get(requireVideoEditInstance(projectId))?.controller.abort(new DOMException('预渲染已取消。', 'AbortError')) }

export interface VideoEditRenderCacheRequest {
  range?: { startFrame: number; endFrame: number }; scope: 'needed' | 'all'
  /** Render the window under this frame first, then the following ones, then the earlier ones. */
  aroundFrame?: number
  /** Started by the idle scheduler rather than the user or the assistant. */
  auto?: boolean
}
export interface VideoEditRenderCacheResult { renderedWindows: number; readyFrames: number; requestedFrames: number; cancelled: boolean }

/**
 * 渲染当前序列范围内的窗口（默认只渲染吃力的窗口，`all` 连实时窗口一起），已就绪的跳过。
 * 节目播放时暂停渲染，不与播放争抢显卡；可取消，取消时只保留已完成的窗口。
 */
export async function renderVideoEditRenderCache(projectId: string, request: VideoEditRenderCacheRequest, signal?: AbortSignal, onStarted?: (plan: { pendingWindows: number; requestedFrames: number; readyFrames: number }) => void): Promise<VideoEditRenderCacheResult> {
  const instance = requireVideoEditInstance(projectId)
  const running = jobs.get(instance)
  if (running && !running.auto) throw new Error('该剪辑正在预渲染，请等待完成或先取消。')
  // A user or assistant request replaces the idle job (its finished windows stay ready).
  if (running) { running.controller.abort(new DOMException('改为按请求预渲染。', 'AbortError')); while (jobs.get(instance)) await new Promise(resolve => setTimeout(resolve, 20)) }
  const composition = getActiveVideoEditSequence(instance)
  const cache = await cacheOf(projectId); loaded.set(projectId, cache)
  const range = request.range ?? { startFrame: 0, endFrame: Number.MAX_SAFE_INTEGER }
  const windows = videoEditRenderCacheWindows(composition).filter(window => window.endFrame > range.startFrame && window.startFrame < range.endFrame && (request.scope === 'all' || window.heavy))
  const around = request.aroundFrame
  const encoding = videoEditRenderProfile(composition)
  const pending = windows.filter(window => !readyEntry(cache, window, encoding.profile))
    .sort((a, b) => around === undefined ? a.startFrame - b.startFrame : (a.endFrame <= around ? 1 : 0) - (b.endFrame <= around ? 1 : 0) || (a.endFrame <= around ? b.startFrame - a.startFrame : a.startFrame - b.startFrame))
  const job: Job = { sequenceId: composition.id, controller: new AbortController(), total: pending.length, done: 0, auto: request.auto === true }
  const abort = (): void => job.controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  jobs.set(instance, job); publishVideoEdit()
  onStarted?.({ pendingWindows: pending.length, requestedFrames: windows.reduce((sum, window) => sum + window.endFrame - window.startFrame, 0), readyFrames: windows.filter(window => readyEntry(cache, window, encoding.profile)).reduce((sum, window) => sum + window.endFrame - window.startFrame, 0) })
  const platform = getPlatform()
  let session: VideoEditRenderSession | undefined
  const started = performance.now()
  logger.info('开始预渲染', { event: 'video_edit.render_cache.start', context: { projectId, sequenceId: composition.id, windows: pending.length, auto: job.auto, codec: encoding.codec, bitrateMbps: encoding.bitrateMbps } })
  try {
    // Windows of this sequence that no longer match its content or profile are never played again.
    const current = new Set(videoEditRenderCacheWindows(composition).map(window => window.key))
    const stale = [...cache.entries.values()].filter(entry => entry.sequenceId === composition.id && (!current.has(entry.windowKey) || entry.profile !== encoding.profile))
    if (stale.length) {
      for (const entry of stale) cache.entries.delete(entry.windowKey)
      await platform.mediaCache.renderRemove({ projectId, windowKeys: stale.map(entry => entry.windowKey) }).catch(error => logger.warn('过期预渲染文件未删除', { event: 'video_edit.render_cache.stale_remove_failed', error }))
    }
    if (pending.length) {
      const smartRegions = await waitVideoEditSmartRegions(composition, composition, job.controller.signal)
      await waitVideoEditTracking(composition, composition, job.controller.signal)
      session = new VideoEditRenderSession({ ...composition })
      session.setSmartRegions(smartRegions); session.setTracks(videoEditTrackResults(composition))
    }
    for (const window of pending) {
      job.controller.signal.throwIfAborted()
      assertOwner()
      job.current = window.key; publishVideoEdit()
      const path = await platform.mediaCache.renderBegin({ projectId, windowKey: window.key, profile: encoding.profile })
      const output = new Output({ format: new Mp4OutputFormat(), target: new StreamTarget(new WritableStream({ write: async chunk => { await platform.system.fs.writeFile(path, chunk.data, { position: chunk.position }) } }), { chunked: true, chunkSize: 4 * 1024 * 1024 }) })
      try {
        const video = new CanvasSource(session!.canvas, videoEditExportVideoOptions({ codec: encoding.codec, width: composition.width, height: composition.height, fps: composition.fps, videoBitrateMbps: encoding.bitrateMbps, bitrateMode: encoding.bitrateMode, encoderPreference: encoding.encoderPreference, keyframeInterval: encoding.keyframeInterval }))
        output.addVideoTrack(video, { frameRate: composition.fps })
        await output.start()
        for (let frame = window.startFrame; frame < window.endFrame; frame++) {
          // 每帧核对原实例；重开后的新实例不能让旧任务继续占用同一显卡。
          assertOwner()
          while (listVideoEditInstances().some(value => value.playing || value.scrubbing || value.busy)) {
            await new Promise(resolve => setTimeout(resolve, 100))
            assertOwner()
          }
          job.controller.signal.throwIfAborted()
          await session!.render(frame, true)
          await video.add((frame - window.startFrame) / composition.fps, 1 / composition.fps)
        }
        await output.finalize()
      } catch (error) {
        await output.cancel().catch(() => undefined)
        await platform.mediaCache.renderDiscard(path).catch(() => undefined)
        throw error
      }
      const stored = await platform.mediaCache.renderCommit({ temporaryPath: path, entry: { projectId, sequenceId: composition.id, windowKey: window.key, profile: encoding.profile, startFrame: window.startFrame, endFrame: window.endFrame, width: composition.width, height: composition.height, fps: composition.fps } })
      cache.entries.set(window.key, stored)
      job.done++; job.current = undefined; publishVideoEdit()
    }
    logger.info('预渲染完成', { event: 'video_edit.render_cache.completed', context: { projectId, sequenceId: composition.id, windows: job.done, elapsedMs: Math.round(performance.now() - started) } })
    return result(false)
  } catch (error) {
    if (job.controller.signal.aborted) {
      logger.info('预渲染已取消', { event: 'video_edit.render_cache.cancelled', context: { projectId, windows: job.done } })
      return result(true)
    }
    logger.warn('预渲染失败', { event: 'video_edit.render_cache.failed', error, context: { projectId, sequenceId: composition.id, windows: job.done } })
    throw error
  } finally {
    signal?.removeEventListener('abort', abort)
    jobs.delete(instance); publishVideoEdit()
    await session?.dispose()
  }
  function assertOwner(): void {
    if (!listVideoEditInstances().includes(instance)) job.controller.abort(new DOMException('原剪辑已关闭，预渲染已停止。', 'AbortError'))
    job.controller.signal.throwIfAborted()
  }
  function result(cancelled: boolean): VideoEditRenderCacheResult {
    return { renderedWindows: job.done, cancelled, requestedFrames: windows.reduce((sum, window) => sum + window.endFrame - window.startFrame, 0),
      readyFrames: windows.filter(window => readyEntry(cache, window, encoding.profile)).reduce((sum, window) => sum + window.endFrame - window.startFrame, 0) }
  }
}

/** 删除该剪辑的全部预览文件（例如磁盘不够时）。 */
export async function clearVideoEditRenderCache(projectId: string): Promise<void> {
  requireVideoEditInstance(projectId)
  cancelVideoEditRenderCache(projectId)
  const cache = await cacheOf(projectId)
  await getPlatform().mediaCache.renderRemove({ projectId })
  cache.entries.clear(); publishVideoEdit()
}
