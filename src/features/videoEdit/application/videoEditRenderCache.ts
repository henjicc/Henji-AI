import { CanvasSource, Mp4OutputFormat, Output, StreamTarget } from 'mediabunny'
import { z } from 'zod'
import { videoEditRenderWindowSet, type VideoEditRenderWindow, type VideoEditRenderWindowSet } from '@/core/videoEdit/renderCache'
import { videoEditRenderEncoding, type VideoEditRenderEncoding } from '@/core/videoEdit/renderBitrate'
import type { VideoRenderCacheStoredEntry } from '@/core/videoEdit/renderCacheStore'
import { getMediaCacheSettings, subscribeMediaCacheSettings } from '@/services/mediaCache/mediaCacheSettings'
import { resolveRenderCacheCodec } from '@/services/mediaCache/hardwareCapabilities'
import { videoEditComposition, type VideoEditComposition } from '@/core/videoEdit/document'
import { createLogger } from '@/core/logging'
import { getPlatform } from '@/platform/runtime'
import { fontLibrarySnapshot } from '@/platform/fonts'
import { VideoEditRenderSession } from '../engine/videoEditRenderSession'
import { videoEditExportVideoOptions } from '../engine/videoEditExportEncoder'
import { findActiveVideoEditSequence, getActiveVideoEditSequence, listVideoEditInstances, publishVideoEdit, requireVideoEditInstance, subscribeVideoEditDomain, subscribeVideoEditView, type VideoEditInstance } from './videoEditService'
import { videoEditTrackResults, waitVideoEditTracking, subscribeVideoEditTracking } from './videoEditTracking'
import { videoEditSmartRegionSegments, waitVideoEditSmartRegions, subscribeVideoEditSmartRegions } from './videoEditSmartRegions'
import { videoEditMeasuredRenderState, type VideoEditRenderPerformance } from '@/core/videoEdit/renderPerformance'
import { loadVideoEditRenderPerformance, readVideoEditRenderPerformance, recordVideoEditRenderPerformance } from './videoEditRenderPerformance'
import { VideoEditCodeMetadataPending } from './videoEditCodeState'
import { settleVideoEditCodeDeclarations, subscribeVideoEditCodeDeclarations, videoEditCodeDeclarationReader } from './videoEditCodeDeclarations'
import { subscribeVideoEditWebContent, videoEditWebContentIdentity, watchVideoEditWebContent } from './videoEditWebContent'
import type { RenderResponse } from '../engine/videoEditWorker'

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
/** 导出等忙碌让出后，节目这么久没有新的操作才继续预渲染（与编辑后的空闲等待一致）。 */
const RENDER_RESUME_IDLE_MS = AUTO_RENDER_IDLE_MS
/**
 * 用户刚操作过节目（播放、暂停、拖动、跳转）时，起播往往紧随其后：这么久没有新的操作才开始或继续预渲染。
 * 预渲染与节目各用一个渲染 Worker，但共用原生解码服务（一把设备锁、一个硬件解码引擎）与显卡进程；预渲染
 * 恢复后的第一帧要重开设备、编译源码、远距离定位（实测 0.3–0.4 秒），这段工作不能中途收回，正赶上起播时
 * 节目第一帧就排在它后面（实测跳转后停 3.2 秒恢复、1.3 秒后起播，起播耗时 0.6 秒）。
 */
const RENDER_AFTER_INTERACTION_MS = 10_000
/** 恢复后不久又被节目操作打断，下一次的等待加倍，最多到这么长；完整渲染完一个窗口后回到起始等待。 */
const RENDER_AFTER_INTERACTION_MAX_MS = 60_000
/** 恢复后这么久之内又被节目操作打断，算作恢复得太早。 */
const RENDER_EARLY_PREEMPT_MS = 30_000
/** 订阅之外的兜底轮询：不经视图发布的状态变化也能及时让出。 */
const PROGRAM_ACTIVITY_POLL_MS = 100
/**
 * 自动预渲染的占空比：每渲完一帧（含编码）歇同样长的时间，显卡最多占一半。空闲时连续渲染实测占显卡 17–35%，
 * 与暂停画面、拖动争抢；歇着的时候节目一有操作就随让出信号立即结束，用户或助手发起的预渲染不歇。
 */
const AUTO_RENDER_REST_RATIO = 1

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
let stopViewWatch: (() => void) | undefined
/** 任一实例最近一次节目操作（播放、拖动、跳转）的时刻：自动预渲染开始前按它等待，任务开始后也接着用。 */
let programInteractionAt = Number.NEGATIVE_INFINITY
const viewFrames = new WeakMap<VideoEditInstance, number>()
function noteProgramInteraction(): void {
  for (const instance of listVideoEditInstances()) {
    const seek = viewFrames.has(instance) && viewFrames.get(instance) !== instance.frame
    viewFrames.set(instance, instance.frame)
    if (instance.playing || instance.scrubbing || seek) programInteractionAt = performance.now()
  }
}
/** Starts watching open projects for idle time (once, when a program monitor first reads its cache). */
function ensureAutoRender(): void {
  if (autoTimer) return
  noteProgramInteraction()
  stopViewWatch = subscribeVideoEditView(noteProgramInteraction)
  autoTimer = setInterval(() => {
    noteProgramInteraction()
    const now = performance.now()
    for (const instance of listVideoEditInstances()) {
      const projectId = instance.document.id
      const content = `${instance.activeSequenceId}\u0000${instance.document.revision}`
      let state = autoState.get(instance)
      if (!state) { state = { content, changedAt: now }; autoState.set(instance, state) }
      // An edit makes windows rendered from the old content useless: stop the automatic job and wait for quiet again.
      if (state.content !== content) { state.content = content; state.changedAt = now; state.controller?.abort(new DOMException('剪辑内容已改变。', 'AbortError')) }
      if (!getVideoEditRenderPreference(projectId).autoRender || !loaded.has(projectId) || jobs.get(instance) || !instance.activeSequenceId) continue
      if (instance.playing || instance.scrubbing || instance.busy || now - state.changedAt < AUTO_RENDER_IDLE_MS || now - programInteractionAt < RENDER_AFTER_INTERACTION_MS) continue
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
    if (!listVideoEditInstances().length) { clearInterval(autoTimer); autoTimer = undefined; stopViewWatch?.(); stopViewWatch = undefined }
  }, 1000)
}
const jobs = new WeakMap<VideoEditInstance, Job>()

export function videoEditRenderCacheBusy(owner: VideoEditInstance): boolean { return jobs.has(owner) }

export type VideoEditRenderWindowState = 'ready' | 'rendering' | 'dropped' | 'predicted' | 'realtime'
export interface VideoEditRenderCacheView {
  windows: Array<{ startFrame: number; endFrame: number; state: VideoEditRenderWindowState; performance?: VideoEditRenderPerformance }>
  readyFrames: number; needsRenderFrames: number; totalFrames: number
  rendering: { done: number; total: number } | null
}

function cacheOf(projectId: string): Promise<ProjectCache> {
  let pending = caches.get(projectId)
  if (!pending) {
    pending = (async () => {
      await loadVideoEditRenderPerformance()
      const entries = new Map<string, Entry>()
      for (const entry of await getPlatform().mediaCache.renderList(projectId)) entries.set(entry.windowKey, entry)
      // 按所有现存序列的内容回收，不能按最初写文件的序列删：其他位置可能仍复用该文件。
      const instance = listVideoEditInstances().find(value => value.document.id === projectId)
      if (instance) await pruneEntries(instance, { entries })
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
  return entry && entry.profile === profile && entry.endFrame - entry.startFrame === window.endFrame - window.startFrame ? entry : undefined
}

let analysisRevision = 0
subscribeVideoEditTracking(() => { analysisRevision++ })
subscribeVideoEditSmartRegions(() => { analysisRevision++ })
// 读不出的代码声明在后台重读成功：引用片子数据的段从整份计入换回按时段计入，和分析结果一样让窗口重算并通知界面。
subscribeVideoEditCodeDeclarations(() => { analysisRevision++; barRevision++; for (const listener of barListeners) listener(); publishVideoEdit() })
// 网页文件夹的内容指纹取到或变化：用到它的窗口指纹随之改变。
subscribeVideoEditWebContent(() => { analysisRevision++; barRevision++; for (const listener of barListeners) listener(); publishVideoEdit() })
// 打开着的剪辑引用的网页文件夹一直交给主进程监视（不论页面开没开），文件夹一改就经上面的通知让窗口失效。
subscribeVideoEditDomain(() => watchVideoEditWebContent(listVideoEditInstances().map(instance => instance.document)))
const windowMemo = new WeakMap<VideoEditComposition, { revision: number; fontRevision: number; windows: VideoEditRenderWindow[] }>()
/**
 * 每条序列上一次算出的窗口与输入签名。每次编辑都会产生新的文档快照，按对象缓存必然落空；
 * 签名相同（只改声音、元数据或其他序列）时整份沿用，不再逐段散列。签名决定全部窗口，同 ID 的不同工程只会少命中，不会用错。
 */
const lastWindowSets = new Map<string, VideoEditRenderWindowSet>()
const LAST_WINDOW_SET_LIMIT = 32
function windowsCurrent(composition: VideoEditComposition): boolean {
  const memo = windowMemo.get(composition)
  return memo?.revision === analysisRevision && memo.fontRevision === fontLibrarySnapshot().revision
}
/**
 * 当前序列的窗口与指纹；同一文档快照与依赖只算一次。片子数据按代码声明分段计入，声明还在读取时抛出
 * VideoEditCodeMetadataPending：这时的指纹和读好以后的不同，不能拿来回收或渲染文件。
 */
export function videoEditRenderCacheWindows(owner: VideoEditInstance, composition: VideoEditComposition): VideoEditRenderWindow[] {
  const fontRevision = fontLibrarySnapshot().revision
  const memo = windowMemo.get(composition)
  if (memo?.revision === analysisRevision && memo.fontRevision === fontRevision) return memo.windows
  const dependencies = { fontRevision, analysis: JSON.stringify([videoEditTrackResults(composition), videoEditSmartRegionSegments()]), codeDeclarations: videoEditCodeDeclarationReader(owner), webContent: videoEditWebContentIdentity }
  const set = videoEditRenderWindowSet(composition, dependencies, lastWindowSets.get(composition.id))
  lastWindowSets.delete(composition.id); lastWindowSets.set(composition.id, set)
  if (lastWindowSets.size > LAST_WINDOW_SET_LIMIT) lastWindowSets.delete(lastWindowSets.keys().next().value!)
  windowMemo.set(composition, { revision: analysisRevision, fontRevision, windows: set.windows })
  return set.windows
}

const announcedDeclarations = new WeakSet<Promise<void>>()
/** 同步读数用：代码声明还在读取时先当作没有窗口，读好后通知节目与渲染条重读（同一次读取只通知一次）。 */
function currentWindows(owner: VideoEditInstance, composition: VideoEditComposition): VideoEditRenderWindow[] | undefined {
  try { return videoEditRenderCacheWindows(owner, composition) }
  catch (error) {
    if (!(error instanceof VideoEditCodeMetadataPending)) throw error
    if (!announcedDeclarations.has(error.ready)) {
      announcedDeclarations.add(error.ready)
      const announce = (): void => { barRevision++; for (const listener of barListeners) listener(); publishVideoEdit() }
      void error.ready.then(announce, announce)
    }
    return undefined
  }
}

/** 非当前序列的合成按文档快照缓存：同一快照反复回收时不重算窗口。当前序列与节目、渲染条共用同一份。 */
const sequenceCompositions = new WeakMap<VideoEditInstance['document'], Map<string, VideoEditComposition>>()
function sequenceComposition(instance: VideoEditInstance, sequenceId: string): VideoEditComposition {
  if (sequenceId === instance.activeSequenceId) return getActiveVideoEditSequence(instance)
  let cache = sequenceCompositions.get(instance.document)
  if (!cache) { cache = new Map(); sequenceCompositions.set(instance.document, cache) }
  let composition = cache.get(sequenceId)
  if (!composition) { composition = videoEditComposition(instance.document, sequenceId); cache.set(sequenceId, composition) }
  return composition
}

async function pruneEntries(instance: VideoEditInstance, cache: ProjectCache): Promise<void> {
  // 等代码声明读好再回收：读取中算出的指纹和最终的不同，会把还能用的文件当成过期删掉。
  const valid = await settleVideoEditCodeDeclarations(() => new Map(instance.document.sequences.flatMap(sequence => {
    const composition = sequenceComposition(instance, sequence.id), profile = videoEditRenderProfile(composition).profile
    return videoEditRenderCacheWindows(instance, composition).map(window => [window.key, profile] as const)
  })))
  const stale = [...cache.entries.values()].filter(entry => valid.get(entry.windowKey) !== entry.profile)
  if (!stale.length) return
  for (const entry of stale) cache.entries.delete(entry.windowKey)
  try { await getPlatform().mediaCache.renderRemove({ projectId: instance.document.id, windowKeys: stale.map(entry => entry.windowKey) }) }
  catch (error) { logger.warn('过期预渲染文件未回收', { event: 'video_edit.render_cache.prune_failed', error, context: { projectId: instance.document.id } }) }
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
  const owner = listVideoEditInstances().find(value => value.document.id === projectId)
  const windows = cache && owner && currentWindows(owner, composition)
  if (!cache || !windows) return []
  const { profile } = videoEditRenderProfile(composition)
  return windows.flatMap(window => {
    const entry = readyEntry(cache, window, profile)
    return entry ? [{ key: entry.windowKey, startFrame: window.startFrame, endFrame: window.endFrame, path: entry.path, width: entry.width, height: entry.height, fps: entry.fps }] : []
  })
}

function measuredState(window: VideoEditRenderWindow): 'dropped' | 'predicted' | 'realtime' {
  return videoEditMeasuredRenderState(window.heavy, readVideoEditRenderPerformance(window.key))
}
const slowSamples = new Map<string, { elapsedMs: number; frame: number; stages: Record<string, number> }>()

/** 每个剪辑上一次正向呈现的帧：与本次之间被播放时钟跳过的帧就是没按时出现的画面。 */
const lastShown = new Map<string, { composition: VideoEditComposition; frame: number; at: number }>()

/**
 * 只有节目正向播放的回执进入统计；迟到的旧文档、拖动和观察一律排除。
 * 实时合成的帧记渲染耗时；两次呈现之间被跳过的帧记为未按时出现，算在它们所在的段上（预览文件呈现的帧只用来接续）。
 */
export function recordVideoEditProgramRender(projectId: string, composition: VideoEditComposition, frame: number, result: RenderResponse, forward: boolean): void {
  if (!forward || result.presented !== true) return
  const instance = requireVideoEditInstance(projectId)
  if (!instance.playing || instance.playbackDirection !== 1 || instance.scrubbing || findActiveVideoEditSequence(instance) !== composition) { lastShown.delete(projectId); return }
  const now = performance.now(), previous = lastShown.get(projectId)
  lastShown.set(projectId, { composition, frame, at: now })
  const windows = currentWindows(instance, composition)
  if (!windows) return
  const windowAt = (at: number): VideoEditRenderWindow | undefined => windows.find(window => window.startFrame <= at && window.endFrame > at)
  // 同一次连续播放（一秒内、向前不超过一秒）才算跳帧；起播、跳转或停顿后的第一帧只作为新的起点。
  if (previous && previous.composition === composition && frame > previous.frame && frame - previous.frame <= composition.fps && now - previous.at < 1000) {
    for (let missing = previous.frame + 1; missing < frame; missing++) {
      const window = windowAt(missing)
      if (window) observe(projectId, composition, window, missing, null)
    }
  }
  if (result.renderCached !== false || result.renderElapsedMs === undefined || !Number.isFinite(result.renderElapsedMs)) return
  const window = windowAt(frame)
  if (!window) return
  if (result.renderElapsedMs > 1000 / composition.fps && result.renderElapsedMs > (slowSamples.get(window.key)?.elapsedMs ?? 0)) {
    slowSamples.set(window.key, { elapsedMs: result.renderElapsedMs, frame, stages: result.renderStages ?? {} })
    if (slowSamples.size > 256) slowSamples.delete(slowSamples.keys().next().value!)
  }
  observe(projectId, composition, window, frame, result.renderElapsedMs)
}
function observe(projectId: string, composition: VideoEditComposition, window: VideoEditRenderWindow, frame: number, elapsedMs: number | null): void {
  const before = measuredState(window)
  const measurement = recordVideoEditRenderPerformance(window.key, composition.fps, elapsedMs)
  const after = videoEditMeasuredRenderState(window.heavy, measurement)
  if (after === before) return
  publishVideoEdit()
  if (after !== 'dropped') return
  const slow = slowSamples.get(window.key)
  const stages = Object.entries(slow?.stages ?? {}).filter(([stage]) => stage !== 'presentDeadline').sort((a, b) => b[1] - a[1])
  logger.info('实时播放段落跳帧', { event: 'video_edit.render_cache.dropped', context: { projectId, sequenceId: composition.id,
    startFrame: window.startFrame, endFrame: window.endFrame, frame, frameBudgetMs: 1000 / composition.fps, ...measurement,
    slowestFrame: slow?.frame, slowestElapsedMs: slow?.elapsedMs, slowestStage: stages[0]?.[0], stages: Object.fromEntries(stages) } })
}

/** 渲染条由就绪文件、任务与实测共同派生；实测样本足够时覆盖启发式。 */
export function readVideoEditRenderCache(projectId: string, sequenceId?: string): VideoEditRenderCacheView {
  const instance = requireVideoEditInstance(projectId)
  // An empty project has nothing to render.
  const composition = findActiveVideoEditSequence(instance)
  if (!composition) return { windows: [], readyFrames: 0, needsRenderFrames: 0, totalFrames: 0, rendering: null }
  if (sequenceId && sequenceId !== composition.id) throw new Error('只能读取当前序列的渲染状态，请先切换到该序列。')
  const cache = loadedCache(projectId, true)
  const job = jobs.get(instance)
  const { profile } = videoEditRenderProfile(composition)
  const windows = (currentWindows(instance, composition) ?? []).map(window => ({ startFrame: window.startFrame, endFrame: window.endFrame,
    ...(readVideoEditRenderPerformance(window.key) ? { performance: readVideoEditRenderPerformance(window.key) } : {}),
    state: readyEntry(cache, window, profile) ? 'ready' as const : job?.current === window.key ? 'rendering' as const : measuredState(window) }))
  const frames = (state: VideoEditRenderWindowState): number => windows.filter(window => window.state === state).reduce((sum, window) => sum + window.endFrame - window.startFrame, 0)
  return { windows, readyFrames: frames('ready'), needsRenderFrames: frames('dropped') + frames('predicted'), totalFrames: windows.at(-1)?.endFrame ?? 0, rendering: job && job.sequenceId === composition.id ? { done: job.done, total: job.total } : null }
}

let barRevision = 0
const barListeners = new Set<() => void>()
/** 渲染条在空闲时算完新窗口后收到通知。 */
export function subscribeVideoEditRenderBar(listener: () => void): () => void { barListeners.add(listener); return () => { barListeners.delete(listener) } }
export function videoEditRenderBarRevision(): number { return barRevision }
const lastBarViews = new Map<string, { sequenceId: string; view: VideoEditRenderCacheView }>()
const pendingBarWindows = new WeakSet<VideoEditComposition>()
/**
 * 渲染条的读数，重绘时不逐段散列：当前内容的窗口已算过就给当前结果；还没算过时给同一序列上一次的结果并标为过期，
 * 由渲染条在绘制后调 requestVideoEditRenderBarWindows 空闲时补算（编辑当下按键到重绘不等它）。
 */
export function peekVideoEditRenderCache(projectId: string): { view: VideoEditRenderCacheView | null; current: boolean } {
  const instance = requireVideoEditInstance(projectId)
  const composition = findActiveVideoEditSequence(instance)
  if (!composition || windowsCurrent(composition)) {
    const view = readVideoEditRenderCache(projectId)
    if (composition) lastBarViews.set(projectId, { sequenceId: composition.id, view })
    return { view, current: true }
  }
  const last = lastBarViews.get(projectId)
  return { view: last?.sequenceId === composition.id ? last.view : null, current: false }
}
const whenIdle = (run: () => void): void => { if (typeof requestIdleCallback === 'function') requestIdleCallback(() => run(), { timeout: 300 }); else setTimeout(run, 0) }
/** 空闲时算当前序列的窗口，算完通知渲染条；期间又有编辑时只算最新的内容。 */
export function requestVideoEditRenderBarWindows(projectId: string): void {
  const current = (): VideoEditComposition | undefined => { const owner = listVideoEditInstances().find(value => value.document.id === projectId); return owner && findActiveVideoEditSequence(owner) }
  const composition = current()
  if (!composition || windowsCurrent(composition) || pendingBarWindows.has(composition)) return
  pendingBarWindows.add(composition)
  whenIdle(() => {
    if (current() !== composition) { pendingBarWindows.delete(composition); return }
    // 算不出的内容（如转场引用已失效）保持挂起：播放头每动一下都会重绘渲染条，不能每次重试、重复记日志。
    const owner = listVideoEditInstances().find(value => value.document.id === projectId)
    if (!owner) { pendingBarWindows.delete(composition); return }
    try {
      // 代码声明读好以后 currentWindows 会通知渲染条，那时再补算。
      if (!currentWindows(owner, composition)) { pendingBarWindows.delete(composition); return }
    } catch (error) { logger.warn('渲染条分段未算出', { event: 'video_edit.render_cache.windows_failed', error, context: { projectId } }); return }
    pendingBarWindows.delete(composition)
    barRevision++
    for (const listener of barListeners) listener()
  })
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
 * needed 只补实测掉帧和未实测但预计吃力的段；all 是 PR“渲染入点到出点”，包括实时段，已就绪跳过。
 * 节目起播、拖动、跳转或导出时立即取消在途这一帧并释放会话，空闲后从该窗口起点重来，不与播放争抢显卡与解码；
 * 节目操作之后的空闲要求更长（RENDER_AFTER_INTERACTION_MS，恢复过早被打断时加倍），恢复时节目很少正要起播；
 * 可取消，取消时只保留已完成的窗口。
 */
export async function renderVideoEditRenderCache(projectId: string, request: VideoEditRenderCacheRequest, signal?: AbortSignal, onStarted?: (plan: { pendingWindows: number; requestedFrames: number; readyFrames: number }) => void): Promise<VideoEditRenderCacheResult> {
  const instance = requireVideoEditInstance(projectId)
  const running = jobs.get(instance)
  if (running && !running.auto) throw new Error('该剪辑正在预渲染，请等待完成或先取消。')
  // A user or assistant request replaces the idle job (its finished windows stay ready).
  if (running) { running.controller.abort(new DOMException('改为按请求预渲染。', 'AbortError')); while (jobs.get(instance)) await new Promise(resolve => setTimeout(resolve, 20)) }
  const composition = getActiveVideoEditSequence(instance)
  const cache = await cacheOf(projectId); loaded.set(projectId, cache)
  if (jobs.has(instance)) throw new Error('该剪辑正在预渲染，请等待完成或先取消。')
  const range = request.range ?? { startFrame: 0, endFrame: Number.MAX_SAFE_INTEGER }
  const all = await settleVideoEditCodeDeclarations(() => videoEditRenderCacheWindows(instance, composition))
  if (jobs.has(instance)) throw new Error('该剪辑正在预渲染，请等待完成或先取消。')
  let windows = all.filter(window => window.endFrame > range.startFrame && window.startFrame < range.endFrame && (request.scope === 'all' || measuredState(window) !== 'realtime'))
  const around = request.aroundFrame
  const encoding = videoEditRenderProfile(composition)
  let pending = [...new Map(windows.filter(window => !readyEntry(cache, window, encoding.profile)).map(window => [window.key, window])).values()]
    .sort((a, b) => around === undefined ? a.startFrame - b.startFrame : (a.endFrame <= around ? 1 : 0) - (b.endFrame <= around ? 1 : 0) || (a.endFrame <= around ? b.startFrame - a.startFrame : a.startFrame - b.startFrame))
  const job: Job = { sequenceId: composition.id, controller: new AbortController(), total: pending.length, done: 0, auto: request.auto === true }
  const abort = (): void => job.controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  jobs.set(instance, job); publishVideoEdit()
  onStarted?.({ pendingWindows: pending.length, requestedFrames: windows.reduce((sum, window) => sum + window.endFrame - window.startFrame, 0), readyFrames: windows.filter(window => readyEntry(cache, window, encoding.profile)).reduce((sum, window) => sum + window.endFrame - window.startFrame, 0) })
  const platform = getPlatform()
  let session: VideoEditRenderSession | undefined
  /** 让出时释放、尚未关完的会话；重开前等它关闭，新旧会话不同时占用解码。 */
  let closing: Promise<void> | undefined
  let smartRegions: Awaited<ReturnType<typeof waitVideoEditSmartRegions>> | undefined
  /** 正在渲染的窗口：节目一有操作就取消它并释放会话，空闲后从该窗口起点重来（已完成的窗口不重做）。 */
  let attempt: { controller: AbortController; window: VideoEditRenderWindow; frame: number } | undefined
  let yielded: { at: number; startFrame: number } | undefined
  /** 节目操作之后要空闲多久才继续；恢复后很快又被打断就加倍（见 RENDER_AFTER_INTERACTION_MS）。 */
  let interactionIdleMs = RENDER_AFTER_INTERACTION_MS
  let resumedAt: number | undefined
  const started = performance.now()
  // 自动任务接着用开始前的节目操作（刚停播就开始也会撞上紧接着的起播）；用户请求从请求时算起。
  const activity = watchProgramActivity(reason => {
    if (!attempt || attempt.controller.signal.aborted) return
    attempt.controller.abort(new DOMException('节目开始播放，预渲染让出。', 'AbortError'))
    if (reason !== 'busy' && resumedAt !== undefined && performance.now() - resumedAt < RENDER_EARLY_PREEMPT_MS) interactionIdleMs = Math.min(RENDER_AFTER_INTERACTION_MAX_MS, interactionIdleMs * 2)
    resumedAt = undefined
    yielded = { at: performance.now(), startFrame: attempt.window.startFrame }
    const released = session; session = undefined
    if (released) closing = released.dispose().catch(error => logger.warn('让出播放时预渲染会话未正常关闭', { event: 'video_edit.render_cache.release_failed', error, context: { projectId } }))
    logger.info('节目有操作，取消正在预渲染的画面并释放会话', { event: 'video_edit.render_cache.preempted', context: { projectId, sequenceId: composition.id, reason, startFrame: attempt.window.startFrame, endFrame: attempt.window.endFrame, frame: attempt.frame, windows: job.done, nextIdleMs: reason === 'busy' ? RENDER_RESUME_IDLE_MS : interactionIdleMs } })
  }, job.auto ? programInteractionAt : Number.NEGATIVE_INFINITY)
  /** 距最近一次操作够久，且距最近一次节目操作（播放、拖动、跳转）也够久。 */
  const programIdle = (): boolean => activity.idleFor() >= RENDER_RESUME_IDLE_MS && activity.interactionIdleFor() >= interactionIdleMs
  logger.info('开始预渲染', { event: 'video_edit.render_cache.start', context: { projectId, sequenceId: composition.id, windows: pending.length, auto: job.auto, codec: encoding.codec, bitrateMbps: encoding.bitrateMbps } })
  try {
    await pruneEntries(instance, cache)
    if (pending.length) {
      smartRegions = await waitVideoEditSmartRegions(composition, composition, job.controller.signal)
      await waitVideoEditTracking(composition, composition, job.controller.signal)
      // 分析刚完成会改变指纹；编码必须使用实际交给会话的结果身份，不能把新画面写到旧键。
      const refreshed = new Map((await settleVideoEditCodeDeclarations(() => videoEditRenderCacheWindows(instance, composition))).map(window => [window.startFrame, window]))
      windows = windows.map(window => refreshed.get(window.startFrame)!)
      pending = [...new Map(pending.map(window => refreshed.get(window.startFrame)!).filter(window => !readyEntry(cache, window, encoding.profile)).map(window => [window.key, window])).values()]
      job.total = pending.length
    }
    for (const window of pending) {
      for (;;) {
        await waitProgramIdle()
        if (closing) { await closing; closing = undefined }
        // 等会话关闭期间又有操作就重新等空闲；从这里到登记 attempt 都是同步的，中途起播不会漏掉。
        if (!programIdle()) continue
        if (yielded) {
          logger.info('节目空闲，继续预渲染', { event: 'video_edit.render_cache.resumed', context: { projectId, sequenceId: composition.id, startFrame: yielded.startFrame, pausedMs: Math.round(performance.now() - yielded.at), requiredIdleMs: interactionIdleMs, windows: job.done } })
          yielded = undefined
          resumedAt = performance.now()
        }
        session ??= openSession()
        const controller = new AbortController()
        const follow = (): void => controller.abort(job.controller.signal.reason)
        job.controller.signal.addEventListener('abort', follow, { once: true })
        attempt = { controller, window, frame: window.startFrame }
        try {
          activity.check()
          await renderWindow(window, session, controller.signal)
          break
        } catch (error) {
          // 只有让出播放才重来同一窗口；取消、关闭原剪辑和真实失败照常结束任务。
          if (job.controller.signal.aborted || !controller.signal.aborted) throw error
          job.current = undefined; publishVideoEdit()
        } finally {
          attempt = undefined
          job.controller.signal.removeEventListener('abort', follow)
        }
      }
      job.done++; job.current = undefined; publishVideoEdit()
      // A whole window went through: the next interruption starts from the base wait again.
      interactionIdleMs = RENDER_AFTER_INTERACTION_MS; resumedAt = undefined
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
    activity.dispose()
    signal?.removeEventListener('abort', abort)
    jobs.delete(instance); publishVideoEdit()
    await closing
    await session?.dispose()
  }
  function openSession(): VideoEditRenderSession {
    const value = new VideoEditRenderSession({ ...composition })
    value.setSmartRegions(smartRegions!); value.setTracks(videoEditTrackResults(composition))
    return value
  }
  /** 一个窗口完整编码后才登记；中途让出、取消或失败都丢弃临时文件，缓存里不会有半成品。 */
  async function renderWindow(window: VideoEditRenderWindow, renderer: VideoEditRenderSession, attemptSignal: AbortSignal): Promise<void> {
    job.current = window.key; publishVideoEdit()
    const path = await platform.mediaCache.renderBegin({ projectId, windowKey: window.key, profile: encoding.profile })
    const output = new Output({ format: new Mp4OutputFormat(), target: new StreamTarget(new WritableStream({ write: async chunk => { await platform.system.fs.writeFile(path, chunk.data, { position: chunk.position }) } }), { chunked: true, chunkSize: 4 * 1024 * 1024 }) })
    try {
      const video = new CanvasSource(renderer.canvas, videoEditExportVideoOptions({ codec: encoding.codec, width: composition.width, height: composition.height, fps: composition.fps, videoBitrateMbps: encoding.bitrateMbps, bitrateMode: encoding.bitrateMode, encoderPreference: encoding.encoderPreference, keyframeInterval: encoding.keyframeInterval }))
      output.addVideoTrack(video, { frameRate: composition.fps })
      await output.start()
      for (let frame = window.startFrame; frame < window.endFrame; frame++) {
        // 每帧核对原实例；重开后的新实例不能让旧任务继续占用同一显卡。
        assertOwner()
        attemptSignal.throwIfAborted()
        if (attempt) attempt.frame = frame
        const frameStarted = performance.now()
        // 让出时会话随即释放，不再等在途这一帧算完。
        await abortable(renderer.render(frame, true), attemptSignal)
        await video.add((frame - window.startFrame) / composition.fps, 1 / composition.fps, { keyFrame: true })
        if (job.auto) await rest((performance.now() - frameStarted) * AUTO_RENDER_REST_RATIO, attemptSignal)
      }
      await output.finalize()
      assertOwner()
      const stored = await platform.mediaCache.renderCommit({ temporaryPath: path, entry: { projectId, sequenceId: composition.id, windowKey: window.key, profile: encoding.profile, startFrame: window.startFrame, endFrame: window.endFrame, width: composition.width, height: composition.height, fps: composition.fps } })
      cache.entries.set(window.key, stored)
    } catch (error) {
      await output.cancel().catch(() => undefined)
      await platform.mediaCache.renderDiscard(path).catch(() => undefined)
      throw error
    }
  }
  async function waitProgramIdle(): Promise<void> {
    assertOwner()
    activity.check()
    while (!programIdle()) {
      await new Promise(resolve => setTimeout(resolve, Math.min(PROGRAM_ACTIVITY_POLL_MS, Math.max(1, RENDER_RESUME_IDLE_MS - activity.idleFor(), interactionIdleMs - activity.interactionIdleFor()))))
      assertOwner()
      activity.check()
    }
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

type ProgramActivity = 'playing' | 'scrubbing' | 'busy' | 'seek'
/**
 * 节目的播放、拖动、跳转与导出：视图一发布就判断（起播立即让出），另有短轮询兜底。
 * idleFor 是距最近一次操作的时长，interactionIdleFor 只算节目操作（播放、拖动、跳转，不含导出等忙碌），
 * 从 `interactedAt`（此前已知的最近一次节目操作）起算；从未有操作时为无穷大。
 */
function watchProgramActivity(onActive: (reason: ProgramActivity) => void, interactedAt: number): { check: () => ProgramActivity | undefined; idleFor: () => number; interactionIdleFor: () => number; dispose: () => void } {
  const frames = new WeakMap<VideoEditInstance, number>()
  for (const instance of listVideoEditInstances()) frames.set(instance, instance.frame)
  let lastActiveAt = Number.NEGATIVE_INFINITY, lastInteractionAt = interactedAt
  const check = (): ProgramActivity | undefined => {
    let reason: ProgramActivity | undefined, interaction = false
    for (const instance of listVideoEditInstances()) {
      const seek = frames.has(instance) && frames.get(instance) !== instance.frame
      frames.set(instance, instance.frame)
      reason ??= instance.playing ? 'playing' : instance.scrubbing ? 'scrubbing' : instance.busy ? 'busy' : seek ? 'seek' : undefined
      if (instance.playing || instance.scrubbing || seek) interaction = true
    }
    if (reason) { lastActiveAt = performance.now(); if (interaction) lastInteractionAt = lastActiveAt; onActive(reason) }
    return reason
  }
  const unsubscribe = subscribeVideoEditView(() => { check() })
  const timer = setInterval(check, PROGRAM_ACTIVITY_POLL_MS)
  return { check, idleFor: () => performance.now() - lastActiveAt, interactionIdleFor: () => performance.now() - lastInteractionAt, dispose: () => { unsubscribe(); clearInterval(timer) } }
}
/** 等 `ms` 毫秒；信号一中止就以它的原因结束。 */
function rest(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason)
  if (!(ms > 0)) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
/** 在途请求随信号立即结束；原请求迟到的结果被吞掉，不成为未处理的拒绝。 */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  work.catch(() => undefined)
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(value => { signal.removeEventListener('abort', onAbort); resolve(value) }, error => { signal.removeEventListener('abort', onAbort); reject(error) })
  })
}

/** 删除该剪辑的全部预览文件（例如磁盘不够时）。 */
export async function clearVideoEditRenderCache(projectId: string): Promise<void> {
  const instance = requireVideoEditInstance(projectId)
  cancelVideoEditRenderCache(projectId)
  // 等当前段停止写入，避免删除后迟到的 commit 重新出现绿段。
  while (jobs.has(instance)) await new Promise(resolve => setTimeout(resolve, 20))
  const cache = await cacheOf(projectId)
  await getPlatform().mediaCache.renderRemove({ projectId })
  cache.entries.clear(); publishVideoEdit()
}
