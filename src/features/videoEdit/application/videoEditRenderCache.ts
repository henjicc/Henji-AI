import { videoEditFramesComposable } from './videoEditHeadlessGuard'
import type { VideoEditRenderPrecision } from '../engine/videoEditRenderer'
import { videoEditRenderFingerprints, subscribeVideoEditRenderFingerprints } from './videoEditRenderFingerprints'
import { videoEditCodeInputParameters } from '@/core/videoEdit/codeInputParameters'
import { isCodeImageReference } from '@/core/videoEdit/codeMaterial/contract'
import { z } from 'zod'
import { videoEditRenderWindowRanges, videoEditRenderWindowSet, type VideoEditRenderWindow as VideoEditRenderContentWindow, type VideoEditRenderWindowSet } from '@/core/videoEdit/renderCache'
import { videoEditRenderWindowsHeavy } from '@/core/videoEdit/renderLoad'
import type { VideoRenderCacheStoredEntry } from '@/core/videoEdit/renderCacheStore'
import { subscribeMediaCacheSettings } from '@/services/mediaCache/mediaCacheSettings'
import { videoEditComposition, type VideoEditComposition } from '@/core/videoEdit/document'
import { createLogger } from '@/core/logging'
import { getPlatform } from '@/platform/runtime'
import { fontLibrarySnapshot } from '@/platform/fonts'
import type { VideoEditRenderSession } from '../engine/videoEditRenderSession'
import { videoEditFirstFramePending } from '../engine/videoEditFirstFrameTiming'
import { VIDEO_EDIT_ENCODE_FRAMES_IN_FLIGHT } from '../engine/videoEditRenderTransport'
import { abortable, encodeVideoEditRenderWindow, openVideoEditRenderSession, videoEditRenderProfile } from './videoEditRenderCacheEncode'
import { findActiveVideoEditSequence, getActiveVideoEditSequence, listVideoEditInstances, publishVideoEdit, requireVideoEditInstance, subscribeVideoEditDomain, subscribeVideoEditView, type VideoEditInstance } from './videoEditService'
import { videoEditTrackResults, waitVideoEditTracking, subscribeVideoEditTracking } from './videoEditTracking'
import { videoEditSmartRegionSegments, waitVideoEditSmartRegions, subscribeVideoEditSmartRegions } from './videoEditSmartRegions'
import { videoEditMeasuredRenderState, type VideoEditRenderPerformance } from '@/core/videoEdit/renderPerformance'
import { loadVideoEditRenderPerformance, readVideoEditRenderPerformance, recordVideoEditRenderPerformance } from './videoEditRenderPerformance'
import { VideoEditCodeMetadataPending } from './videoEditCodeState'
import { settleVideoEditCodeDeclarations, subscribeVideoEditCodeDeclarations, videoEditCodeDeclarationReader } from './videoEditCodeDeclarations'
import { subscribeVideoEditWebContent, videoEditWebContentIdentity, watchVideoEditWebContent } from './videoEditWebContent'
import type { RenderResponse } from '../engine/videoEditWorker'
import { createWebCacheActivityReporter } from './videoEditWebCacheActivity'
import { subscribeVideoEditUserInput, videoEditGpuTask, videoEditRecordingActive, videoEditUserIdleBasis, videoEditUserInputIdleFor } from './videoEditRenderCacheForeground'

/**
 * 预渲染（PR“渲染入点到出点”与渲染条）：吃力的窗口在后台渲染成预览文件，节目正向播放时整帧取自文件。
 * 文件由主进程放进作品目录缓存（统一受缓存管理的容量上限与保留天数约束），按窗口内容指纹与编码档案寻址；
 * 参数、源码、素材任一依赖改变只让受影响窗口失效，预渲染格式或画质改变时按新档案重做。
 * 拖动与松手先读已就绪预览；需要观察作者元素或导出时由节目渲染路径决定是否现场合成。
 */
const logger = createLogger('features.videoEdit.renderCache')
const reportWebCacheForeground = createWebCacheActivityReporter(active => getPlatform().videoFrames.webCacheForeground(active),
  error => logger.warn('网页补录前台活动同步失败', { event: 'video_edit.web_cache.activity_failed', error }))
/**
 * 自动预渲染：编辑停下这么久、且没有播放、拖动或导出时才开始。放入片段、改完参数后用户多半紧接着就播放或继续改，
 * 几秒的停顿说明不了闲着；实测放入多机位片段 3 秒后就开始跑 4K 满负载约 18 秒，正好压在随后的播放上。
 */
const AUTO_RENDER_IDLE_MS = 10_000
/** 刚打开或新建的剪辑这么久之内不自动预渲染：打开后的首帧、缩略图、波形、指纹和用户的第一轮操作都在这段时间里。 */
const AUTO_RENDER_OPEN_SETTLE_MS = 30_000
const AUTO_RENDER_RETRY_MS = 30_000
/** 导出、建代理等前台任务让出后，这么久没有新的忙碌才继续预渲染。 */
const RENDER_RESUME_IDLE_MS = 3000
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
/**
 * 自动预渲染最快按实时速度的一半出帧：4K60 序列每秒只解、只编 30 帧，约半路参考解码与半路编码，给前台播放、
 * 录屏编码和系统留出大半显卡。只在用户闲着时跑，慢一些不影响体验；占空比之外再限速，是因为渲染很快时占空比管不住吞吐。
 */
const AUTO_RENDER_MAX_SPEED = 0.5

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
/** 同一窗口的精确文件与用了网页缓存的文件各自成份：精确消费方只能读前者。缺来源的旧文件按实时网页计。 */
function entryIdentity(entry: Pick<Entry, 'windowKey' | 'profile' | 'provenance'>): string {
  return JSON.stringify([entry.windowKey, entry.profile, entry.provenance ?? 'live'])
}
/** 每个剪辑已完成的预览文件，按窗口指纹、编码档案与来源索引。 */
interface ProjectCache { entries: Map<string, Entry> }
const caches = new Map<string, Promise<ProjectCache>>()

// Format or quality changes make other profiles stale: the render bar and the idle scheduler pick it up.
subscribeMediaCacheSettings(() => publishVideoEdit())
/** paused：用户或助手发起的任务正在为录屏让开时给界面看的原因。 */
interface Job { sequenceId: string; controller: AbortController; total: number; done: number; current?: string; auto: boolean; paused?: string }
/** 每个打开的剪辑：自动预渲染针对的内容、内容最近一次改变与剪辑被看到（打开）的时刻。 */
const autoState = new WeakMap<VideoEditInstance, { content: string; changedAt: number; openedAt: number; controller?: AbortController }>()
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
  if (autoTimer || !videoEditFramesComposable()) return
  noteProgramInteraction()
  const stopInteraction = subscribeVideoEditView(noteProgramInteraction)
  const background = watchProgramActivity(() => undefined, programInteractionAt, () => {
    reportWebCacheForeground(background.idleFor() < RENDER_RESUME_IDLE_MS || listVideoEditInstances().some(videoEditRenderCacheBusy))
  })
  background.check()
  stopViewWatch = () => { stopInteraction(); background.dispose(); reportWebCacheForeground(false) }
  autoTimer = setInterval(() => {
    noteProgramInteraction()
    const now = performance.now()
    const instances = listVideoEditInstances()
    // 全机同一时刻最多一个预渲染：几个打开的剪辑各跑一个会让解码与编码成倍增加。
    let running = instances.some(instance => jobs.has(instance) || planning.has(instance))
    // 任一剪辑在播放、拖动或导出，或有录屏、建代理等前台任务，都不开始：它们和预渲染抢同一块显卡。
    const foreground = instances.some(instance => instance.playing || instance.scrubbing || instance.busy) || videoEditGpuTask() !== undefined
    const inputIdleMs = videoEditUserInputIdleFor()
    for (const instance of instances) {
      const projectId = instance.document.id
      const content = `${instance.activeSequenceId}\u0000${instance.contentVersion}`
      let state = autoState.get(instance)
      if (!state) { state = { content, changedAt: now, openedAt: now }; autoState.set(instance, state) }
      // An edit makes windows rendered from the old content useless: stop the automatic job and wait for quiet again.
      if (state.content !== content) { state.content = content; state.changedAt = now; state.controller?.abort(new DOMException('剪辑内容已改变。', 'AbortError')) }
      if (running || foreground || !getVideoEditRenderPreference(projectId).autoRender || !loaded.has(projectId) || clearing.has(instance) || cancelling.has(instance) || !instance.activeSequenceId) continue
      // 首帧上屏前不抢解码与显卡：先出画面，后台再建缓存。
      if (videoEditFirstFramePending(projectId) || now - state.openedAt < AUTO_RENDER_OPEN_SETTLE_MS || now - state.changedAt < AUTO_RENDER_IDLE_MS || now - programInteractionAt < RENDER_AFTER_INTERACTION_MS) continue
      // 用户闲着：全系统空闲，或窗口有焦点且应用内空闲；窗口须可见（见 videoEditUserIdleBasis）。
      const idleBasis = videoEditUserIdleBasis()
      if (!idleBasis) continue
      const composition = findActiveVideoEditSequence(instance)
      // 多机位源序列不自动预渲染：它的预览文件只服务直接播放源序列本身，渲染时却要同时解全部机位（最重的负载）；
      // 节目里的多机位片段只解所选那一路，不读源序列的预览文件。
      if (!composition || composition.multicam) continue
      let windows: number
      try { windows = autoRenderCandidates(instance, composition) } catch { continue }
      if (!windows) continue
      logger.info('用户空闲，自动预渲染', { event: 'video_edit.render_cache.auto_start', context: { projectId, sequenceId: composition.id, windows, idleBasis,
        openedMs: Math.round(now - state.openedAt), editIdleMs: Math.round(now - state.changedAt), inputIdleMs: Number.isFinite(inputIdleMs) ? Math.round(inputIdleMs) : null,
        interactionIdleMs: Number.isFinite(now - programInteractionAt) ? Math.round(now - programInteractionAt) : null } })
      running = true
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
const planning = new WeakMap<VideoEditInstance, AbortController>()
const clearing = new WeakMap<VideoEditInstance, Promise<void>>()
const cancelling = new WeakMap<VideoEditInstance, Promise<void>>()

/**
 * 正在实际占用解码与显卡：在算窗口，或有窗口在渲染。为节目让开而暂停的任务不算，悬停取帧、网页补录不必为它停下。
 */
export function videoEditRenderCacheBusy(owner: VideoEditInstance): boolean { return planning.has(owner) || jobs.get(owner)?.current !== undefined }

export type VideoEditRenderWindowState = 'ready' | 'rendering' | 'dropped' | 'predicted' | 'realtime'
export interface VideoEditRenderCacheView {
  windows: Array<{ startFrame: number; endFrame: number; state: VideoEditRenderWindowState; performance?: VideoEditRenderPerformance }>
  readyFrames: number; needsRenderFrames: number; totalFrames: number
  /** auto：空闲时自动渲染的任务；用户或助手发起的渲染会直接接替它。 */
  /** paused：为录屏等独占显卡的前台工作暂停时的原因（用户看得懂的一句话）。 */
  rendering: { done: number; total: number; auto: boolean; paused?: string } | null
}

function cacheOf(projectId: string): Promise<ProjectCache> {
  let pending = caches.get(projectId)
  if (!pending) {
    pending = (async () => {
      await loadVideoEditRenderPerformance()
      const entries = new Map<string, Entry>()
      for (const entry of await getPlatform().mediaCache.renderList(projectId)) entries.set(entryIdentity(entry), entry)
      // 加载只读索引；历史文件交给统一媒体缓存回收，不让节目读缓存等待其他序列的指纹。
      return { entries }
    })()
    pending.catch(() => caches.delete(projectId))
    caches.set(projectId, pending)
  }
  return pending
}
/** A file counts only when it was rendered for this window with the current profile; an exact consumer only takes one made without web cache pictures. */
function readyEntry(cache: ProjectCache | undefined, window: VideoEditRenderWindow, profile: string, precision: VideoEditRenderPrecision): Entry | undefined {
  if (window.fingerprintPending) return undefined
  const entry = cache?.entries.get(entryIdentity({ windowKey: window.key, profile }))
    ?? (precision === 'web-cache' ? cache?.entries.get(entryIdentity({ windowKey: window.key, profile, provenance: 'web-cache' })) : undefined)
  return entry && entry.endFrame - entry.startFrame === window.endFrame - window.startFrame ? entry : undefined
}

let analysisRevision = 0
subscribeVideoEditTracking(() => { analysisRevision++ })
subscribeVideoEditSmartRegions(() => { analysisRevision++ })
// 读不出的代码声明在后台重读成功：引用片子数据的段从整份计入换回按时段计入，和分析结果一样让窗口重算并通知界面。
subscribeVideoEditCodeDeclarations(() => { analysisRevision++; barRevision++; for (const listener of barListeners) listener(); publishVideoEdit() })
// 每个窗口的帧表一就绪便使同步读取与渲染条失效，不等待其他片段的剩余窗口。
subscribeVideoEditRenderFingerprints(() => { analysisRevision++; barRevision++; for (const listener of barListeners) listener(); publishVideoEdit() })
// 网页文件夹的内容指纹取到或变化：用到它的窗口指纹随之改变。
subscribeVideoEditWebContent(() => { analysisRevision++; barRevision++; for (const listener of barListeners) listener(); publishVideoEdit() })
// 打开着的剪辑引用的网页文件夹一直交给主进程监视（不论页面开没开），文件夹一改就经上面的通知让窗口失效。
subscribeVideoEditDomain(() => watchVideoEditWebContent(listVideoEditInstances().map(instance => instance.document)))
/** 调度用的窗口：内容指纹之外带上预计吃不吃力（只决定先渲哪些，不进指纹，见 core/videoEdit/renderLoad）。 */
export type VideoEditRenderWindow = VideoEditRenderContentWindow & { heavy: boolean }
const windowMemo = new WeakMap<VideoEditComposition, { revision: number; fontRevision: number; windows: VideoEditRenderWindow[] }>()
/** 同一份切段（签名相同时原样沿用）只判断一次吃力。 */
const heavyWindows = new WeakMap<VideoEditRenderWindowSet, VideoEditRenderWindow[]>()
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
  const webContent = Object.fromEntries(composition.clips.flatMap(clip => Object.values(videoEditCodeInputParameters(composition, clip.code, dependencies.codeDeclarations)).flatMap(value => isCodeImageReference(value) && value.kind === 'web' ? [[value.path, videoEditWebContentIdentity(value.path)]] : [])))
  const codeFingerprints = videoEditRenderFingerprints(owner, composition, JSON.stringify([fontRevision, dependencies.analysis]), webContent, dependencies.codeDeclarations,
    () => fontLibrarySnapshot().revision === fontRevision
      && JSON.stringify([videoEditTrackResults(composition), videoEditSmartRegionSegments()]) === dependencies.analysis
      && Object.entries(webContent).every(([path, identity]) => videoEditWebContentIdentity(path) === identity))
  const set = videoEditRenderWindowSet(composition, { ...dependencies, codeFingerprints }, lastWindowSets.get(composition.id))
  lastWindowSets.delete(composition.id); lastWindowSets.set(composition.id, set)
  if (lastWindowSets.size > LAST_WINDOW_SET_LIMIT) lastWindowSets.delete(lastWindowSets.keys().next().value!)
  let windows = heavyWindows.get(set)
  if (!windows) {
    const heavy = videoEditRenderWindowsHeavy(composition, set.windows)
    windows = set.windows.map((window, index) => ({ ...window, heavy: heavy[index] }))
    heavyWindows.set(set, windows)
  }
  windowMemo.set(composition, { revision: analysisRevision, fontRevision, windows })
  return windows
}

function pendingWindows(composition: VideoEditComposition): VideoEditRenderWindow[] {
  return videoEditRenderWindowRanges(composition).map((range, index) => ({ ...range, index, key: `pending:${range.startFrame}`, heavy: true, fingerprintPending: true }))
}
const announcedDeclarations = new WeakSet<Promise<void>>()
/** 同步读数用：代码声明还在读取时先显示未就绪窗口，读好后通知节目与渲染条重读（同一次读取只通知一次）。 */
function currentWindows(owner: VideoEditInstance, composition: VideoEditComposition): VideoEditRenderWindow[] | undefined {
  try { return videoEditRenderCacheWindows(owner, composition) }
  catch (error) {
    if (!(error instanceof VideoEditCodeMetadataPending)) throw error
    if (!announcedDeclarations.has(error.ready)) {
      announcedDeclarations.add(error.ready)
      const announce = (): void => { barRevision++; for (const listener of barListeners) listener(); publishVideoEdit() }
      void error.ready.then(announce, announce)
    }
    return pendingWindows(composition)
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

// 历史窗口保留给撤销和重复内容复用；磁盘容量与保留天数由统一媒体缓存回收。

const loaded = new Map<string, ProjectCache>()
/** 已加载的项目缓存（同步读取用）；节目监视器打开时触发加载，完成后通知界面。 */
function loadedCache(projectId: string, load = false): ProjectCache | undefined {
  const cache = loaded.get(projectId)
  if (load) ensureAutoRender()
  if (!cache && load) void cacheOf(projectId).then(value => { if (!loaded.has(projectId)) { loaded.set(projectId, value); publishVideoEdit() } }, error => logger.warn('预渲染缓存读取失败', { event: 'video_edit.render_cache.load_failed', error, context: { projectId } }))
  return cache
}

/** 导出不依赖节目监视器是否打开；加载同一索引并等依赖声明完成后读取就绪窗口。 */
export async function prepareVideoEditRenderWindows(projectId: string, composition: VideoEditComposition, signal: AbortSignal): Promise<ReturnType<typeof readyVideoEditRenderWindows>> {
  const cache = await abortable(cacheOf(projectId), signal)
  const owner = requireVideoEditInstance(projectId)
  const contentVersion = owner.contentVersion
  await abortable(settleVideoEditCodeDeclarations(() => videoEditRenderCacheWindows(owner, composition)), signal)
  // 先核对候选旧预览的当前帧指纹，再固定导出文件表；主循环无需等待或刷新指纹。
  const profile = videoEditRenderProfile(composition).profile
  if ([...cache.entries.values()].some(entry => entry.profile === profile)) {
    const controller = new AbortController(), abort = (): void => controller.abort(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    const timer = setTimeout(() => controller.abort(new Error('画面指纹尚未就绪，使用现场合成导出。')), 30_000)
    try { await waitFingerprintWindows(owner, composition, contentVersion, undefined, controller.signal) }
    finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
  }
  return readyWindows(cache, owner, composition)
}

/** 节目当前序列已就绪的预渲染窗口（本地文件）；指纹不匹配的旧文件不会被播放。 */
export function readyVideoEditRenderWindows(projectId: string, composition: VideoEditComposition): Array<{ key: string; startFrame: number; endFrame: number; path: string; width: number; height: number; fps: number; provenance?: VideoRenderCacheStoredEntry['provenance'] }> {
  const cache = loadedCache(projectId, true)
  const owner = listVideoEditInstances().find(value => value.document.id === projectId)
  return cache && owner ? readyWindows(cache, owner, composition) : []
}
function readyWindows(cache: ProjectCache, owner: VideoEditInstance, composition: VideoEditComposition): ReturnType<typeof readyVideoEditRenderWindows> {
  const windows = currentWindows(owner, composition)
  if (!cache || !windows) return []
  const { profile } = videoEditRenderProfile(composition)
  return windows.flatMap(window => {
    const entry = readyEntry(cache, window, profile, 'web-cache')
    return entry ? [{ provenance: entry.provenance, key: entry.windowKey, startFrame: window.startFrame, endFrame: window.endFrame, path: entry.path, width: entry.width, height: entry.height, fps: entry.fps }] : []
  })
}

function measuredState(window: VideoEditRenderWindow): 'dropped' | 'predicted' | 'realtime' {
  if (window.fingerprintPending) return 'predicted'
  return videoEditMeasuredRenderState(window.heavy, readVideoEditRenderPerformance(window.key))
}
/** 空闲调度的候选：还没有预览文件、且预计或实测带不动的窗口数。 */
function autoRenderCandidates(instance: VideoEditInstance, composition: VideoEditComposition): number {
  const cache = loaded.get(instance.document.id)
  const windows = currentWindows(instance, composition)
  if (!cache || !windows) return 0
  const { profile } = videoEditRenderProfile(composition)
  return windows.filter(window => !readyEntry(cache, window, profile, 'web-cache') && measuredState(window) !== 'realtime').length
}
const slowSamples = new Map<string, { elapsedMs: number; frame: number; stages: Record<string, number> }>()

/**
 * 节目旁边同时在解码的别的画面（多机位格子同时解各机位）。这期间节目掉帧来自格子的负载，不说明节目内容带不动，
 * 不计入实测；否则会去预渲染一份比原片更难解的文件，播放时反而多占一路解码。出帧方每请求一帧就登记一次，
 * 最近这么久之内登记过才算在解码：格子停下（隐藏、尺寸为零、关闭）后很快恢复计入，不靠成对的登记与释放。
 */
const SIDE_LOAD_WINDOW_MS = 1000
const sideLoads = new WeakMap<VideoEditInstance, number>()
export function noteVideoEditProgramSideLoad(owner: VideoEditInstance): void { sideLoads.set(owner, performance.now()) }
const sideLoadActive = (owner: VideoEditInstance): boolean => performance.now() - (sideLoads.get(owner) ?? Number.NEGATIVE_INFINITY) < SIDE_LOAD_WINDOW_MS
/** 每个剪辑上一次正向呈现的帧：与本次之间被播放时钟跳过的帧就是没按时出现的画面。 */
const lastShown = new Map<string, { composition: VideoEditComposition; frame: number; at: number }>()

/**
 * 只有节目正向播放的回执进入统计；迟到的旧文档、拖动和观察一律排除。
 * 实时合成的帧记渲染耗时；两次呈现之间被跳过的帧记为未按时出现，算在它们所在的段上（预览文件呈现的帧只用来接续）。
 */
export function recordVideoEditProgramRender(projectId: string, composition: VideoEditComposition, frame: number, result: RenderResponse, forward: boolean): void {
  if (!forward || result.presented !== true) return
  const instance = requireVideoEditInstance(projectId)
  if (!instance.playing || instance.playbackDirection !== 1 || instance.scrubbing || sideLoadActive(instance) || findActiveVideoEditSequence(instance) !== composition) { lastShown.delete(projectId); return }
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
  // 有图层沿用了早于这一时刻的画面（解码跟不上，只解了参考帧）：这一帧没有按时实时出画，与跳帧一样计入。
  if (result.approximate) { observe(projectId, composition, window, frame, null); return }
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
  if (sequenceId && !instance.document.sequences.some(sequence => sequence.id === sequenceId)) throw new Error('这条序列已不存在。')
  const composition = sequenceId ? sequenceComposition(instance, sequenceId) : findActiveVideoEditSequence(instance)
  if (!composition) return { windows: [], readyFrames: 0, needsRenderFrames: 0, totalFrames: 0, rendering: null }
  const cache = loadedCache(projectId, true)
  const job = jobs.get(instance)
  const { profile } = videoEditRenderProfile(composition)
  const windows = (currentWindows(instance, composition) ?? []).map(window => ({ startFrame: window.startFrame, endFrame: window.endFrame,
    ...(readVideoEditRenderPerformance(window.key) ? { performance: readVideoEditRenderPerformance(window.key) } : {}),
    state: readyEntry(cache, window, profile, 'web-cache') ? 'ready' as const : job?.sequenceId === composition.id && job.current === window.key ? 'rendering' as const : measuredState(window) }))
  const frames = (state: VideoEditRenderWindowState): number => windows.filter(window => window.state === state).reduce((sum, window) => sum + window.endFrame - window.startFrame, 0)
  return { windows, readyFrames: frames('ready'), needsRenderFrames: frames('dropped') + frames('predicted'), totalFrames: windows.at(-1)?.endFrame ?? 0, rendering: job && job.sequenceId === composition.id ? { done: job.done, total: job.total, auto: job.auto, ...(job.paused ? { paused: job.paused } : {}) } : null }
}

let barRevision = 0
const barListeners = new Set<() => void>()
/** 渲染条在空闲时算完新窗口后收到通知。 */
export function subscribeVideoEditRenderBar(listener: () => void): () => void { barListeners.add(listener); return () => { barListeners.delete(listener) } }
export function videoEditRenderBarRevision(): number { return barRevision }
const pendingBarWindows = new WeakSet<VideoEditComposition>()
/**
 * 渲染条的读数，重绘时不逐段散列：当前内容的窗口已算过就给当前结果；还没算过时按当前剪辑边界给未就绪的黄色窗口，
 * 由渲染条在绘制后调 requestVideoEditRenderBarWindows 空闲时补算（编辑当下按键到重绘不等它）。
 */
export function peekVideoEditRenderCache(projectId: string): { view: VideoEditRenderCacheView | null; current: boolean } {
  const instance = requireVideoEditInstance(projectId)
  const composition = findActiveVideoEditSequence(instance)
  if (!composition || windowsCurrent(composition)) {
    const view = readVideoEditRenderCache(projectId)
    return { view, current: true }
  }
  const windows = pendingWindows(composition)
  return { view: { windows: windows.map(({ startFrame, endFrame }) => ({ startFrame, endFrame, state: 'predicted' })),
    totalFrames: windows.at(-1)?.endFrame ?? 0, readyFrames: 0, needsRenderFrames: windows.at(-1)?.endFrame ?? 0, rendering: null }, current: false }
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

export async function cancelVideoEditRenderCache(projectId: string): Promise<void> {
  const instance = requireVideoEditInstance(projectId)
  const pending = cancelling.get(instance)
  if (pending) return pending
  const job = jobs.get(instance)
  const work = (async () => {
    planning.get(instance)?.abort(new DOMException('预渲染已取消。', 'AbortError'))
    job?.controller.abort(new DOMException('预渲染已取消。', 'AbortError'))
    // 等待期间自动调度也必须让出，避免旧任务退出到本次取消回读之间又开出新任务。
    while (job && jobs.get(instance) === job) await new Promise(resolve => setTimeout(resolve, 20))
    const auto = autoState.get(instance)
    if (auto) auto.changedAt = performance.now()
  })()
  cancelling.set(instance, work)
  try { await work } finally { cancelling.delete(instance) }
}

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
 * onStarted 是启动时的候选计划：requestedFrames 含指纹未就绪的窗口，pendingWindows 按候选键去重；
 * needed 会在指纹就绪后剔除判定可实时播放的段，最终范围与就绪帧数以返回结果为准。
 */
export async function renderVideoEditRenderCache(projectId: string, request: VideoEditRenderCacheRequest, signal?: AbortSignal, onStarted?: (plan: { pendingWindows: number; requestedFrames: number; readyFrames: number }) => void): Promise<VideoEditRenderCacheResult> {
  const precision: VideoEditRenderPrecision = request.auto ? 'web-cache' : 'exact'
  const instance = requireVideoEditInstance(projectId)
  if (clearing.has(instance)) throw new Error('正在删除渲染文件，请稍后再渲染。')
  if (cancelling.has(instance)) throw new Error('正在取消渲染，请稍后再渲染。')
  const running = jobs.get(instance)
  if (running && !running.auto) throw new Error('该剪辑正在预渲染，请等待完成或先取消。')
  // A user or assistant request replaces the idle job (its finished windows stay ready).
  if (running) { running.controller.abort(new DOMException('改为按请求预渲染。', 'AbortError')); while (jobs.get(instance)) await new Promise(resolve => setTimeout(resolve, 20)) }
  const composition = getActiveVideoEditSequence(instance)
  const contentVersion = instance.contentVersion
  const range = request.range ?? { startFrame: 0, endFrame: Number.MAX_SAFE_INTEGER }
  if (planning.has(instance)) throw new Error('正在计算渲染窗口，请稍后再试。')
  const planController = new AbortController()
  const abortPlan = (): void => planController.abort(signal?.reason)
  if (signal?.aborted) abortPlan()
  signal?.addEventListener('abort', abortPlan, { once: true })
  planning.set(instance, planController)
  let all: VideoEditRenderWindow[]
  let cache: ProjectCache
  try {
    cache = await abortable(cacheOf(projectId), planController.signal); loaded.set(projectId, cache)
    all = await abortable(settleVideoEditCodeDeclarations(() => {
      planController.signal.throwIfAborted()
      return videoEditRenderCacheWindows(instance, composition)
    }), planController.signal)
  }
  catch (error) {
    if (!planController.signal.aborted) throw error
    return { renderedWindows: 0, readyFrames: 0, requestedFrames: 0, cancelled: true }
  } finally { planning.delete(instance); signal?.removeEventListener('abort', abortPlan) }
  if (instance.contentVersion !== contentVersion || !listVideoEditInstances().includes(instance)) return { renderedWindows: 0, readyFrames: 0, requestedFrames: 0, cancelled: true }
  if (jobs.has(instance) || clearing.has(instance) || cancelling.has(instance)) throw new Error('该剪辑正在预渲染、取消或删除渲染文件，请稍后重试。')
  const encoding = videoEditRenderProfile(composition)
  /** needed 不做实时带得动的段。 */
  const skip = (window: VideoEditRenderWindow): boolean => request.scope !== 'all' && measuredState(window) === 'realtime'
  let windows = all.filter(window => window.endFrame > range.startFrame && window.startFrame < range.endFrame && !skip(window))
  const around = request.aroundFrame
  let pending = [...new Map(windows.filter(window => !readyEntry(cache, window, encoding.profile, precision)).map(window => [window.key, window])).values()]
    .sort((a, b) => around === undefined ? a.startFrame - b.startFrame : (a.endFrame <= around ? 1 : 0) - (b.endFrame <= around ? 1 : 0) || (a.endFrame <= around ? b.startFrame - a.startFrame : a.startFrame - b.startFrame))
  const job: Job = { sequenceId: composition.id, controller: new AbortController(), total: pending.length, done: 0, auto: request.auto === true }
  const abort = (): void => job.controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  jobs.set(instance, job); publishVideoEdit()
  onStarted?.({ pendingWindows: pending.length, requestedFrames: windows.reduce((sum, window) => sum + window.endFrame - window.startFrame, 0), readyFrames: windows.filter(window => readyEntry(cache, window, encoding.profile, precision)).reduce((sum, window) => sum + window.endFrame - window.startFrame, 0) })
  let session: VideoEditRenderSession | undefined
  /** 让出时释放、尚未关完的会话；重开前等它关闭，新旧会话不同时占用解码。 */
  let closing: Promise<void> | undefined
  let smartRegions: Awaited<ReturnType<typeof waitVideoEditSmartRegions>> | undefined
  /** 正在渲染的窗口：节目一有操作就取消它并释放会话，空闲后从该窗口起点重来（已完成的窗口不重做）。 */
  let attempt: { controller: AbortController; window: VideoEditRenderWindow; frame: number } | undefined
  let yielded: { at: number; startFrame?: number } | undefined
  /** 节目操作之后要空闲多久才继续；恢复后很快又被打断就加倍（见 RENDER_AFTER_INTERACTION_MS）。 */
  let interactionIdleMs = RENDER_AFTER_INTERACTION_MS
  let resumedAt: number | undefined
  const started = performance.now()
  // 自动任务接着用开始前的节目操作（刚停播就开始也会撞上紧接着的起播）；用户请求从请求时算起。
  let yields = 0, pausedMs = 0
  const activity = watchProgramActivity((reason, detail) => {
    // 自动任务遇到用户输入或前台任务直接结束（已完成的窗口保留），由空闲调度重新发起：用户可能连续操作几十分钟，
    // 暂停着的任务会一直占着“全机一个”的名额。
    if (job.auto && (reason === 'input' || reason === 'task')) {
      if (job.controller.signal.aborted) return
      logger.info('前台有操作，自动预渲染停止，空闲后重新开始', { event: 'video_edit.render_cache.preempted', context: { projectId, sequenceId: composition.id, reason, ...(detail ? { task: detail } : {}), startFrame: attempt?.window.startFrame, frame: attempt?.frame, windows: job.done, elapsedMs: Math.round(performance.now() - started), stopped: true } })
      job.controller.abort(new DOMException(reason === 'input' ? '用户在操作，自动预渲染停止。' : `前台任务（${detail}）进行中，自动预渲染停止。`, 'AbortError'))
      return
    }
    if (reason === 'task' && !job.paused) { job.paused = '正在录屏，录完后继续渲染'; publishVideoEdit() }
    const current = attempt && !attempt.controller.signal.aborted ? attempt : undefined
    // 两个窗口之间（或等空闲时）会话仍开着：前台一有动作同样释放，不让它占着解码会话与显存等下去。
    if (!current && !session) return
    current?.controller.abort(new DOMException('前台有操作，预渲染让出。', 'AbortError'))
    const program = reason === 'playing' || reason === 'scrubbing' || reason === 'seek'
    if (program && resumedAt !== undefined && performance.now() - resumedAt < RENDER_EARLY_PREEMPT_MS) interactionIdleMs = Math.min(RENDER_AFTER_INTERACTION_MAX_MS, interactionIdleMs * 2)
    resumedAt = undefined
    yields++
    yielded ??= { at: performance.now(), startFrame: current?.window.startFrame }
    const released = session; session = undefined
    if (released) closing = released.dispose().catch(error => logger.warn('让出播放时预渲染会话未正常关闭', { event: 'video_edit.render_cache.release_failed', error, context: { projectId } }))
    logger.info('前台有操作，取消正在预渲染的画面并释放会话', { event: 'video_edit.render_cache.preempted', context: { projectId, sequenceId: composition.id, reason, ...(detail ? { task: detail } : {}), startFrame: current?.window.startFrame, endFrame: current?.window.endFrame, frame: current?.frame, windows: job.done,
      elapsedMs: Math.round(performance.now() - started), nextIdleMs: program ? interactionIdleMs : RENDER_RESUME_IDLE_MS } })
  }, job.auto ? programInteractionAt : Number.NEGATIVE_INFINITY, undefined, {
    input: job.auto,
    // 自动任务只在用户闲着时继续：在别的程序里一有输入（全系统空闲归零）、窗口被隐藏都算用户回来了。
    away: job.auto ? () => videoEditUserIdleBasis() !== undefined : undefined,
    // 自动任务让开一切占显卡的前台工作，以及别的剪辑上用户或助手发起的渲染；发起的渲染只让开录屏（硬件编码器要留给录制）。
    task: job.auto
      ? () => videoEditGpuTask() ?? (listVideoEditInstances().some(other => other !== instance && jobs.get(other) && !jobs.get(other)!.auto) ? 'render' : undefined)
      : () => videoEditRecordingActive() ? 'recording' : undefined,
  })
  /**
   * 距最近一次操作够久，且距最近一次节目操作（播放、拖动、跳转）也够久；自动任务还要用户闲着。
   * 用户或助手发起的预渲染只让开节目与前台任务，不因点按界面停下。
   */
  const programIdle = (): boolean => activity.idleFor() >= RENDER_RESUME_IDLE_MS && activity.interactionIdleFor() >= interactionIdleMs && (!job.auto || videoEditUserIdleBasis() !== undefined)
  logger.info('开始预渲染', { event: 'video_edit.render_cache.start', context: { projectId, sequenceId: composition.id, windows: pending.length, auto: job.auto, codec: encoding.codec, bitrateMbps: encoding.bitrateMbps, ...(job.auto ? { maxSpeed: AUTO_RENDER_MAX_SPEED } : {}) } })
  try {
    assertOwner()
    if (pending.length) {
      smartRegions = await waitVideoEditSmartRegions(composition, composition, job.controller.signal)
      await waitVideoEditTracking(composition, composition, job.controller.signal)
      // 分析刚完成会改变指纹；编码必须使用实际交给会话的结果身份，不能把新画面写到旧键。
      const refreshed = new Map((await abortable(settleVideoEditCodeDeclarations(() => videoEditRenderCacheWindows(instance, composition)), job.controller.signal)).map(window => [window.startFrame, window]))
      assertOwner()
      windows = windows.map(window => refreshed.get(window.startFrame)!)
      pending = [...new Map(pending.map(window => refreshed.get(window.startFrame)!).filter(window => !readyEntry(cache, window, encoding.profile, precision)).map(window => [window.key, window])).values()]
      job.total = pending.length
    }
    for (let window of pending) {
      for (;;) {
        // 只等待这个窗口的键；相邻窗口可继续算，已存在的同键文件立即复用。
        for (;;) {
          assertOwner()
          window = (await abortable(settleVideoEditCodeDeclarations(() => videoEditRenderCacheWindows(instance, composition)), job.controller.signal)).find(value => value.startFrame === window.startFrame)!
          windows = windows.map(value => value.startFrame === window.startFrame ? window : value)
          if (!window.fingerprintPending) break
          await rest(20, job.controller.signal)
        }
        if (skip(window)) {
          windows = windows.filter(value => value.startFrame !== window.startFrame); job.total--; break
        }
        if (readyEntry(cache, window, encoding.profile, precision)) break
        await waitProgramIdle()
        if (closing) { await closing; closing = undefined }
        // 等会话关闭期间又有操作就重新等空闲；从这里到登记 attempt 都是同步的，中途起播不会漏掉。
        if (!programIdle()) continue
        // 暂停原因与有没有让出过会话无关：会话还没打开时就遇到录屏，也在这里清掉。
        if (job.paused) { job.paused = undefined; publishVideoEdit() }
        if (yielded) {
          const paused = performance.now() - yielded.at
          pausedMs += paused
          logger.info('前台空闲，继续预渲染', { event: 'video_edit.render_cache.resumed', context: { projectId, sequenceId: composition.id, startFrame: yielded.startFrame, pausedMs: Math.round(paused), requiredIdleMs: interactionIdleMs, windows: job.done } })
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
          // 渲染期间输入可能变了（如字体库读完、分析结果到达），窗口换了指纹：刚写好的文件按旧指纹登记，
          // 新指纹仍未就绪，回到循环开头按新指纹再渲一遍，不在渲染条上留下补不上的空段。
          const latest = (await abortable(settleVideoEditCodeDeclarations(() => videoEditRenderCacheWindows(instance, composition)), job.controller.signal)).find(value => value.startFrame === window.startFrame)
          if (latest && latest.key !== window.key) continue
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
      if (windows.some(value => value.startFrame === window.startFrame)) job.done++
      job.current = undefined; publishVideoEdit()
      // A whole window went through: the next interruption starts from the base wait again.
      interactionIdleMs = RENDER_AFTER_INTERACTION_MS; resumedAt = undefined
    }
    logger.info('预渲染完成', { event: 'video_edit.render_cache.completed', context: { projectId, sequenceId: composition.id, windows: job.done, auto: job.auto, elapsedMs: Math.round(performance.now() - started), pausedMs: Math.round(pausedMs), yields } })
    return result(false)
  } catch (error) {
    if (job.controller.signal.aborted) {
      const reason = job.controller.signal.reason
      logger.info('预渲染已取消', { event: 'video_edit.render_cache.cancelled', context: { projectId, windows: job.done, auto: job.auto, reason: reason instanceof Error ? reason.message : String(reason), elapsedMs: Math.round(performance.now() - started), pausedMs: Math.round(pausedMs), yields } })
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
  function openSession(): VideoEditRenderSession { return openVideoEditRenderSession(composition, smartRegions!) }
  async function renderWindow(window: VideoEditRenderWindow, renderer: VideoEditRenderSession, attemptSignal: AbortSignal): Promise<void> {
    job.current = window.key; publishVideoEdit()
    let frameStarted = 0
    const stored = await encodeVideoEditRenderWindow({ projectId, composition, window, encoding, precision, renderer, signal: attemptSignal,
      // 自动预渲染按占空比歇着，一次只在途一帧；用户或助手发起的预渲染多帧流水。
      inFlight: job.auto ? 1 : VIDEO_EDIT_ENCODE_FRAMES_IN_FLIGHT,
      beforeFrame: index => {
        // 每帧核对原实例；重开后的新实例不能让旧任务继续占用同一显卡。
        assertOwner()
        if (attempt) attempt.frame = window.startFrame + index
        frameStarted = performance.now()
      },
      afterFrame: async () => {
        if (!job.auto) return
        const elapsed = performance.now() - frameStarted
        await rest(Math.max(elapsed * AUTO_RENDER_REST_RATIO, 1000 / (composition.fps * AUTO_RENDER_MAX_SPEED) - elapsed), attemptSignal)
      },
      beforeCommit: assertOwner,
    })
    cache.entries.set(entryIdentity(stored), stored)
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
    if (!listVideoEditInstances().includes(instance) || instance.contentVersion !== contentVersion) job.controller.abort(new DOMException('原剪辑已关闭，预渲染已停止。', 'AbortError'))
    job.controller.signal.throwIfAborted()
  }
  function result(cancelled: boolean): VideoEditRenderCacheResult {
    return { renderedWindows: job.done, cancelled, requestedFrames: windows.reduce((sum, window) => sum + window.endFrame - window.startFrame, 0),
      readyFrames: windows.filter(window => readyEntry(cache, window, encoding.profile, precision)).reduce((sum, window) => sum + window.endFrame - window.startFrame, 0) }
  }
}

/** busy 是导出；task 是录屏、建代理等占显卡的前台任务（由调用方判断）；input 是用户在界面上按键、点击、滚轮、拖动或切到别的程序。 */
type ProgramActivity = 'playing' | 'scrubbing' | 'busy' | 'seek' | 'task' | 'input'
/**
 * 节目的播放、拖动、跳转与导出：视图一发布就判断（起播立即让出），另有短轮询兜底。
 * 给了 task 时它返回的前台任务也算忙碌（reason 为 task，detail 是任务名）；input 时用户输入一发生就通知（reason 为 input，不计入 idleFor）；
 * 给了 away 时它返回 false（用户不再闲着）也按 input 通知，detail 为 away。
 * idleFor 是距最近一次操作的时长，interactionIdleFor 只算节目操作（播放、拖动、跳转，不含导出等忙碌），
 * 从 `interactedAt`（此前已知的最近一次节目操作）起算；从未有操作时为无穷大。
 */
function watchProgramActivity(onActive: (reason: ProgramActivity, detail?: string) => void, interactedAt: number, onSample?: () => void, options: { task?: () => string | undefined; input?: boolean; away?: () => boolean } = {}): { check: () => ProgramActivity | undefined; idleFor: () => number; interactionIdleFor: () => number; dispose: () => void } {
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
    const task = !reason ? options.task?.() : undefined
    if (task) reason = 'task'
    if (reason) { lastActiveAt = performance.now(); if (interaction) lastInteractionAt = lastActiveAt; onActive(reason, task) }
    else if (options.away && !options.away()) onActive('input', 'away')
    onSample?.()
    return reason
  }
  const unsubscribe = subscribeVideoEditView(() => { check() })
  const unsubscribeInput = options.input ? subscribeVideoEditUserInput(() => onActive('input')) : () => undefined
  const timer = setInterval(check, PROGRAM_ACTIVITY_POLL_MS)
  return { check, idleFor: () => performance.now() - lastActiveAt, interactionIdleFor: () => performance.now() - lastInteractionAt, dispose: () => { unsubscribe(); unsubscribeInput(); clearInterval(timer) } }
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

/**
 * 删除调用时当前序列的预览；范围为半开区间，整窗相交即删除。缓存可重新生成，不属于用户数据，不进回收区。
 * 先阻止新任务并等待在途任务取消，避免迟到的 commit 在清理后写回；并发清理按调用顺序执行。
 * 文件按内容指纹复用：删除该文件也会使其他位置引用同一指纹的预览失效，原始素材和剪辑内容不受影响。
 */
export async function clearVideoEditRenderCache(projectId: string, range?: { startFrame: number; endFrame: number }, signal?: AbortSignal): Promise<void> {
  const instance = requireVideoEditInstance(projectId)
  const composition = getActiveVideoEditSequence(instance)
  if (range && (!Number.isInteger(range.startFrame) || !Number.isInteger(range.endFrame) || range.startFrame < 0 || range.endFrame <= range.startFrame)) throw new Error('渲染文件范围必须是有效的半开帧区间。')
  const contentVersion = instance.contentVersion
  const previous = clearing.get(instance)
  const clear = async (): Promise<void> => {
    signal?.throwIfAborted()
    const controller = new AbortController()
    const abort = (): void => controller.abort(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => controller.abort(new Error('画面依赖尚未就绪，渲染文件未删除；请在拖动或导出结束后重试。')), 30_000)
    logger.info('开始删除渲染文件', { event: 'video_edit.render_cache.clear_start', context: { projectId, sequenceId: composition.id, range } })
    try {
      planning.get(instance)?.abort(new DOMException('正在删除渲染文件。', 'AbortError'))
      jobs.get(instance)?.controller.abort(new DOMException('正在删除渲染文件。', 'AbortError'))
      while (jobs.has(instance)) await rest(20, controller.signal)
      const cache = await abortable(cacheOf(projectId), controller.signal)
      if (!listVideoEditInstances().includes(instance) || instance.contentVersion !== contentVersion) throw new DOMException('剪辑已关闭或内容已改变。', 'AbortError')
      const windows = await waitFingerprintWindows(instance, composition, contentVersion, range, controller.signal)
      const keys = [...new Set(windows.filter(window => !range || window.endFrame > range.startFrame && window.startFrame < range.endFrame).map(window => window.key))]
      if (keys.length) await getPlatform().mediaCache.renderRemove({ projectId, windowKeys: keys })
      const removedKeys = new Set(keys)
      for (const [identity, entry] of cache.entries) if (removedKeys.has(entry.windowKey)) cache.entries.delete(identity)
      loaded.set(projectId, cache)
      const auto = autoState.get(instance)
      if (auto) auto.changedAt = performance.now()
      publishVideoEdit()
      logger.info('渲染文件已删除', { event: 'video_edit.render_cache.clear_completed', context: { projectId, sequenceId: composition.id, windows: keys.length } })
    } catch (error) {
      logger.warn('删除渲染文件失败', { event: 'video_edit.render_cache.clear_failed', error, context: { projectId, sequenceId: composition.id } })
      throw error
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort)
    }
  }
  const work = (previous ?? Promise.resolve()).then(clear, clear)
  clearing.set(instance, work)
  try { await work } finally { if (clearing.get(instance) === work) clearing.delete(instance) }
}

/** 只等选中窗口；导出与清理共用依赖通知及取消路径，不能用历史文件位置猜当前窗口。 */
function waitFingerprintWindows(owner: VideoEditInstance, composition: VideoEditComposition, contentVersion: number,
  range: { startFrame: number; endFrame: number } | undefined, signal: AbortSignal): Promise<VideoEditRenderWindow[]> {
  return new Promise((resolve, reject) => {
    const finish = (windows?: VideoEditRenderWindow[], error?: unknown): void => {
      stops.forEach(stop => stop()); signal.removeEventListener('abort', aborted)
      if (error) reject(error); else resolve(windows!)
    }
    const aborted = (): void => finish(undefined, signal.reason)
    const check = (): void => {
      try {
        signal?.throwIfAborted()
        if (!listVideoEditInstances().includes(owner) || owner.contentVersion !== contentVersion) throw new DOMException('剪辑已关闭或内容已改变。', 'AbortError')
        const windows = currentWindows(owner, composition) ?? []
        if (!windows.some(window => window.fingerprintPending && (!range || window.endFrame > range.startFrame && window.startFrame < range.endFrame))) finish(windows)
      } catch (error) { finish(undefined, error) }
    }
    const stops = [subscribeVideoEditRenderBar(check), subscribeVideoEditDomain(check), subscribeVideoEditView(check)]
    signal.addEventListener('abort', aborted, { once: true })
    check()
  })
}
