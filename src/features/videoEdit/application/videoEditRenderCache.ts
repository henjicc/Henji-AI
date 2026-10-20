import { CanvasSource, Mp4OutputFormat, Output, StreamTarget } from 'mediabunny'
import { z } from 'zod'
import { videoEditRenderWindows, VIDEO_EDIT_RENDER_CACHE_VERSION, type VideoEditRenderWindow } from '@/core/videoEdit/renderCache'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import { createLogger } from '@/core/logging'
import { getPlatform } from '@/platform/runtime'
import { fontLibrarySnapshot } from '@/platform/fonts'
import { VideoEditRenderSession } from '../engine/videoEditRenderSession'
import { videoEditExportVideoOptions } from '../engine/videoEditExportEncoder'
import { getActiveVideoEditSequence, listVideoEditInstances, publishVideoEdit, requireVideoEditInstance, type VideoEditInstance } from './videoEditService'
import { videoEditTrackResults, waitVideoEditTracking } from './videoEditTracking'
import { videoEditSmartRegionSegments, waitVideoEditSmartRegions } from './videoEditSmartRegions'

/**
 * 预渲染（PR“渲染入点到出点”与渲染条）：吃力的窗口在后台按导出画质渲染成预览文件，节目正向播放时整帧取自文件。
 * 文件在程序缓存目录，按窗口内容指纹命名；参数、源码、素材任一依赖改变只让受影响窗口失效。
 * 暂停画面、拖动、观察与导出始终实时合成，不读预览文件。
 */
const logger = createLogger('features.videoEdit.renderCache')
/** 预览文件码率：4K60 H.264 下肉眼看不出与实时合成的差别，又不至于占满磁盘（30 秒约 300MB）。 */
const RENDER_CACHE_BITRATE_MBPS = 80

const entrySchema = z.object({ key: z.string(), sequenceId: z.string(), file: z.string(), startFrame: z.number().int(), endFrame: z.number().int(), width: z.number().int(), height: z.number().int(), fps: z.number(), bytes: z.number() }).strict()
const indexSchema = z.object({ version: z.literal(VIDEO_EDIT_RENDER_CACHE_VERSION), entries: z.array(entrySchema) }).strict()
type Entry = z.infer<typeof entrySchema>
interface ProjectCache { directory: string; entries: Map<string, Entry & { path: string }> }
const caches = new Map<string, Promise<ProjectCache>>()
interface Job { sequenceId: string; controller: AbortController; total: number; done: number; current?: string }
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
      const platform = getPlatform()
      const directory = await platform.system.paths.join((await platform.system.paths.appDirectories()).programDir, 'video-edit-render-cache', projectId)
      await platform.system.fs.mkdir(directory, { recursive: true })
      await platform.media.allowRoot(directory)
      const entries = new Map<string, Entry & { path: string }>()
      const indexPath = await platform.system.paths.join(directory, 'index.json')
      try {
        const index = indexSchema.parse(JSON.parse(await platform.system.fs.readTextFile(indexPath)))
        for (const entry of index.entries) {
          const path = await platform.system.paths.join(directory, entry.file)
          if (await platform.system.fs.exists(path)) entries.set(entry.key, { ...entry, path })
        }
      } catch { /* no index yet, or an older renderer's cache: start empty */ }
      return { directory, entries }
    })()
    pending.catch(() => caches.delete(projectId))
    caches.set(projectId, pending)
  }
  return pending
}
async function writeIndex(cache: ProjectCache): Promise<void> {
  const platform = getPlatform()
  const entries = [...cache.entries.values()].map(({ path: _path, ...entry }) => entry)
  await platform.system.fs.writeTextFile(await platform.system.paths.join(cache.directory, 'index.json'), JSON.stringify({ version: VIDEO_EDIT_RENDER_CACHE_VERSION, entries }))
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
  if (!cache && load) void cacheOf(projectId).then(value => { if (!loaded.has(projectId)) { loaded.set(projectId, value); publishVideoEdit() } }, error => logger.warn('预渲染缓存读取失败', { event: 'video_edit.render_cache.load_failed', error, context: { projectId } }))
  return cache
}

/** 节目当前序列已就绪的预渲染窗口（本地文件）；指纹不匹配的旧文件不会被播放。 */
export function readyVideoEditRenderWindows(projectId: string, composition: VideoEditComposition): Array<{ key: string; startFrame: number; endFrame: number; path: string; width: number; height: number; fps: number }> {
  const cache = loadedCache(projectId, true)
  if (!cache) return []
  return videoEditRenderCacheWindows(composition).flatMap(window => {
    const entry = cache.entries.get(window.key)
    return entry && entry.startFrame === window.startFrame && entry.endFrame === window.endFrame ? [{ key: entry.key, startFrame: entry.startFrame, endFrame: entry.endFrame, path: entry.path, width: entry.width, height: entry.height, fps: entry.fps }] : []
  })
}

/** 渲染条的状态：已渲染、正在渲染、需要渲染（吃力且未渲染）、实时。 */
export function readVideoEditRenderCache(projectId: string, sequenceId?: string): VideoEditRenderCacheView {
  const instance = requireVideoEditInstance(projectId)
  const composition = getActiveVideoEditSequence(instance)
  if (sequenceId && sequenceId !== composition.id) throw new Error('只能读取当前序列的渲染状态，请先切换到该序列。')
  const cache = loadedCache(projectId)
  const job = jobs.get(instance)
  const windows = videoEditRenderCacheWindows(composition).map(window => ({ startFrame: window.startFrame, endFrame: window.endFrame,
    state: cache?.entries.get(window.key) ? 'ready' as const : job?.current === window.key ? 'rendering' as const : window.heavy ? 'needs_render' as const : 'realtime' as const }))
  const frames = (state: VideoEditRenderWindowState): number => windows.filter(window => window.state === state).reduce((sum, window) => sum + window.endFrame - window.startFrame, 0)
  return { windows, readyFrames: frames('ready'), needsRenderFrames: frames('needs_render'), totalFrames: windows.at(-1)?.endFrame ?? 0, rendering: job && job.sequenceId === composition.id ? { done: job.done, total: job.total } : null }
}

export function cancelVideoEditRenderCache(projectId: string): void { jobs.get(requireVideoEditInstance(projectId))?.controller.abort(new DOMException('预渲染已取消。', 'AbortError')) }

export interface VideoEditRenderCacheRequest { range?: { startFrame: number; endFrame: number }; scope: 'needed' | 'all' }
export interface VideoEditRenderCacheResult { renderedWindows: number; readyFrames: number; requestedFrames: number; cancelled: boolean }

/**
 * 渲染当前序列范围内的窗口（默认只渲染吃力的窗口，`all` 连实时窗口一起），已就绪的跳过。
 * 节目播放时暂停渲染，不与播放争抢显卡；可取消，取消时只保留已完成的窗口。
 */
export async function renderVideoEditRenderCache(projectId: string, request: VideoEditRenderCacheRequest, signal?: AbortSignal, onStarted?: (plan: { pendingWindows: number; requestedFrames: number; readyFrames: number }) => void): Promise<VideoEditRenderCacheResult> {
  const instance = requireVideoEditInstance(projectId)
  if (jobs.get(instance)) throw new Error('该剪辑正在预渲染，请等待完成或先取消。')
  const composition = getActiveVideoEditSequence(instance)
  const cache = await cacheOf(projectId); loaded.set(projectId, cache)
  const range = request.range ?? { startFrame: 0, endFrame: Number.MAX_SAFE_INTEGER }
  const windows = videoEditRenderCacheWindows(composition).filter(window => window.endFrame > range.startFrame && window.startFrame < range.endFrame && (request.scope === 'all' || window.heavy))
  const pending = windows.filter(window => !cache.entries.has(window.key))
  const job: Job = { sequenceId: composition.id, controller: new AbortController(), total: pending.length, done: 0 }
  const abort = (): void => job.controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  jobs.set(instance, job); publishVideoEdit()
  onStarted?.({ pendingWindows: pending.length, requestedFrames: windows.reduce((sum, window) => sum + window.endFrame - window.startFrame, 0), readyFrames: windows.filter(window => cache.entries.has(window.key)).reduce((sum, window) => sum + window.endFrame - window.startFrame, 0) })
  const platform = getPlatform()
  let session: VideoEditRenderSession | undefined
  const started = performance.now()
  logger.info('开始预渲染', { event: 'video_edit.render_cache.start', context: { projectId, sequenceId: composition.id, windows: pending.length } })
  try {
    // Windows of this sequence that no longer match its content are never played again.
    const current = new Set(videoEditRenderCacheWindows(composition).map(window => window.key))
    for (const entry of [...cache.entries.values()]) if (entry.sequenceId === composition.id && !current.has(entry.key)) {
      cache.entries.delete(entry.key); await platform.system.fs.remove(entry.path).catch(() => undefined)
    }
    if (pending.length) {
      const smartRegions = await waitVideoEditSmartRegions(composition, composition, job.controller.signal)
      await waitVideoEditTracking(composition, composition, job.controller.signal)
      session = new VideoEditRenderSession({ ...composition })
      session.setSmartRegions(smartRegions); session.setTracks(videoEditTrackResults(composition))
    }
    for (const window of pending) {
      job.controller.signal.throwIfAborted()
      if (!listVideoEditInstances().includes(instance)) throw new DOMException('原剪辑已关闭，预渲染已停止。', 'AbortError')
      job.current = window.key; publishVideoEdit()
      const file = `${window.key}.mp4`, path = await platform.system.paths.join(cache.directory, file)
      await platform.system.fs.remove(path).catch(() => undefined)
      await platform.system.fs.writeFile(path, new Uint8Array(), { exclusive: true })
      let bytes = 0
      const output = new Output({ format: new Mp4OutputFormat(), target: new StreamTarget(new WritableStream({ write: async chunk => { await platform.system.fs.writeFile(path, chunk.data, { position: chunk.position }); bytes = Math.max(bytes, chunk.position + chunk.data.byteLength) } }), { chunked: true, chunkSize: 4 * 1024 * 1024 }) })
      try {
        const video = new CanvasSource(session!.canvas, videoEditExportVideoOptions({ codec: 'avc', width: composition.width, height: composition.height, fps: composition.fps, videoBitrateMbps: RENDER_CACHE_BITRATE_MBPS, bitrateMode: 'vbr', encoderPreference: 'hardware', keyframeInterval: 1 }))
        output.addVideoTrack(video, { frameRate: composition.fps })
        await output.start()
        for (let frame = window.startFrame; frame < window.endFrame; frame++) {
          // Playing the program takes the GPU: wait instead of competing with it.
          while (instance.playing && !job.controller.signal.aborted) await new Promise(resolve => setTimeout(resolve, 100))
          job.controller.signal.throwIfAborted()
          await session!.render(frame, true)
          await video.add((frame - window.startFrame) / composition.fps, 1 / composition.fps)
        }
        await output.finalize()
      } catch (error) {
        await output.cancel().catch(() => undefined)
        await platform.system.fs.remove(path).catch(() => undefined)
        throw error
      }
      cache.entries.set(window.key, { key: window.key, sequenceId: composition.id, file, startFrame: window.startFrame, endFrame: window.endFrame, width: composition.width, height: composition.height, fps: composition.fps, bytes, path })
      await writeIndex(cache)
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
  function result(cancelled: boolean): VideoEditRenderCacheResult {
    return { renderedWindows: job.done, cancelled, requestedFrames: windows.reduce((sum, window) => sum + window.endFrame - window.startFrame, 0),
      readyFrames: windows.filter(window => cache.entries.has(window.key)).reduce((sum, window) => sum + window.endFrame - window.startFrame, 0) }
  }
}

/** 删除该剪辑的全部预览文件（例如磁盘不够时）。 */
export async function clearVideoEditRenderCache(projectId: string): Promise<void> {
  requireVideoEditInstance(projectId)
  cancelVideoEditRenderCache(projectId)
  const cache = await cacheOf(projectId)
  for (const entry of cache.entries.values()) await getPlatform().system.fs.remove(entry.path).catch(() => undefined)
  cache.entries.clear(); await writeIndex(cache); publishVideoEdit()
}
