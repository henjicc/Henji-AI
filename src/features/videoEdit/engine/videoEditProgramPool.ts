import { createVideoEditSequence, type VideoEditComposition } from '@/core/videoEdit/document'
import { createLogger } from '@/core/logging'
import { getPlatform, isHeadlessWindow } from '@/platform/runtime'
import { VideoEditRenderSession } from './videoEditRenderSession'
import { videoEditNativeDecoding } from './videoEditRenderTransport'
import { videoEditTimingContext, videoEditTimingEvent } from './videoEditFirstFrameTiming'

const logger = createLogger('features.videoEdit.programPool')
type Program = { surface: HTMLCanvasElement; renderer: VideoEditRenderSession; document: VideoEditComposition; ready: boolean }
/** 节目面板卸载时保留下来的工程会话：素材读取已放下，Worker、GPU 设备与管线留着给同一工程再进入时接管。 */
type Parked = { entry: Program; ownerDocument: Document; alive: () => boolean; /** 素材是否已成功放下；失败的会话不能再接管。 */ settled: Promise<boolean> }
/** 最近使用的这么多个工程保留会话，更早的回收：每个会话常驻一个 GPU 设备的基础显存。 */
const PARKED_LIMIT = 2
let spare: Program | undefined
const parked = new Map<string, Parked>()
let owners = 0
let preparationFailed = false
let checking: Promise<void> | undefined
let releaseTimer: ReturnType<typeof setTimeout> | undefined
let memoryTimer: ReturnType<typeof setInterval> | undefined

export function createVideoEditProgramSurface(width: number, height: number): HTMLCanvasElement {
  const surface = document.createElement('canvas')
  surface.width = width; surface.height = height
  surface.setAttribute('aria-label', '剪辑画面'); surface.className = 'h-full w-full object-contain'
  return surface
}
function release(entry: Program, reason: string): Promise<void> {
  logger.info('空闲节目会话已回收', { event: 'video_edit.program.pool.released', context: { reason } })
  return entry.renderer.dispose()
}
function retire(reason: string): void {
  const previous = spare; spare = undefined
  if (previous) void release(previous, reason)
}
function releaseParked(projectId: string, reason: string): Promise<void> {
  const kept = parked.get(projectId)
  if (!kept) return Promise.resolve()
  parked.delete(projectId)
  return release(kept.entry, reason)
}
/** 回收已关闭工程保留的会话（随内存检查定期执行，接管与保留时也顺带清一次）。 */
export function releaseClosedVideoEditPrograms(): Promise<void> {
  return Promise.all([...parked].filter(([, kept]) => !kept.alive() || kept.entry.renderer.terminated).map(([projectId]) => releaseParked(projectId, 'project-closed'))).then(() => undefined)
}
function blankDocument(): VideoEditComposition {
  const sequence = { ...createVideoEditSequence('节目准备'), width: 32, height: 32 }
  return { ...sequence, fps: 30, revision: 0, media: [], items: [] }
}
function watchMemory(): void { memoryTimer ??= setInterval(() => { void checkMemoryAndPrepare() }, 5000) }
function stopWatchingMemory(): void { if (!owners && !parked.size) { clearInterval(memoryTimer); memoryTimer = undefined } }
async function checkMemoryAndPrepare(): Promise<void> {
  if (checking) return checking
  checking = (async () => {
    void releaseClosedVideoEditPrograms()
    // 保留期间设备丢失就立即回收，不等接管后第一帧报错再重建。
    for (const [projectId, kept] of parked) void kept.settled.then(ok => ok ? kept.entry.renderer.prepareGpu() : undefined).catch(error => {
      if (parked.get(projectId) !== kept) return
      logger.warn('保留的节目会话设备已失效', { event: 'video_edit.program.pool.failed', error, context: { projectId } })
      void releaseParked(projectId, 'device-lost')
    })
    stopWatchingMemory()
    if (!owners && !parked.size) return
    // Physical available memory, not the renderer's JS heap. Never retain speculative GPU work under pressure.
    const memory = await getPlatform().system.memoryInfo()
    if (memory.availableBytes < Math.max(512 * 1024 ** 2, memory.totalBytes * 0.05)) {
      retire('memory-pressure')
      for (const projectId of [...parked.keys()]) void releaseParked(projectId, 'memory-pressure')
      stopWatchingMemory()
      return
    }
    if (spare) {
      const entry = spare
      if (entry.ready) await entry.renderer.prepareGpu().catch(error => {
        if (spare === entry) { preparationFailed = true; retire('device-unavailable'); logger.warn('空闲节目设备已失效，打开时重新准备', { event: 'video_edit.program.pool.failed', error }) }
      })
      return
    }
    // 无窗口模式关了显卡，预建的会话永远出不了画面。
    if (!owners || preparationFailed || isHeadlessWindow()) return
    const document = blankDocument()
    const surface = createVideoEditProgramSurface(32, 32)
    const entry: Program = { surface, document, renderer: new VideoEditRenderSession(document, { previewWidth: 32, surface: surface.transferControlToOffscreen() }), ready: false }
    spare = entry
    const started = performance.now()
    logger.info('空闲节目会话开始准备', { event: 'video_edit.program.pool.start' })
    void entry.renderer.prepareGpu().then(() => {
      entry.ready = true
      logger.info('空闲节目会话准备完成', { event: 'video_edit.program.pool.ready', context: { durationMs: performance.now() - started } })
    }).catch(error => {
      if (spare === entry) { preparationFailed = true; retire('prepare-failed'); logger.warn('节目预热失败，打开时按需准备', { event: 'video_edit.program.pool.failed', error }) }
    })
  })().catch(error => {
    retire('memory-check-failed')
    logger.warn('无法检查空闲节目会话资源，跳过预热', { event: 'video_edit.program.pool.memory_failed', error })
  }).finally(() => { checking = undefined })
  return checking
}

/** One unowned Worker/device/channel. StrictMode release/reacquire shares the same pending preparation. */
export function retainVideoEditProgramWarmup(): () => void {
  if (!owners) preparationFailed = false
  owners++; clearTimeout(releaseTimer)
  void checkMemoryAndPrepare()
  watchMemory()
  let released = false
  return () => {
    if (released) return
    released = true
    if (--owners) return
    releaseTimer = setTimeout(() => { retire('workspace-left'); stopWatchingMemory() }, 5000)
  }
}

/**
 * 离开剪辑工作区或节目面板隐藏时调用（参照 PR 切面板不重建播放引擎）：停播放、清预渲染窗口，换成空内容放下全部
 * 素材读取、解码会话与帧缓存，保留 Worker、GPU 设备和管线；同一工程再进入时由 takeVideoEditProgram 直接接管。
 * 工程关闭、设备丢失、系统内存紧张或超出保留数量时回收。
 */
export function parkVideoEditProgram(projectId: string, program: { surface: HTMLCanvasElement; renderer: VideoEditRenderSession }, options: { frame: number; ownerDocument: Document; alive: () => boolean }): void {
  void releaseParked(projectId, 'replaced'); void releaseClosedVideoEditPrograms()
  const { renderer } = program
  if (renderer.terminated || !options.alive()) { void renderer.dispose(); return }
  renderer.stopPlayback(options.frame)
  const document = blankDocument()
  const entry: Program = { surface: program.surface, renderer, document, ready: true }
  // 回到与新建会话相同的显示状态：接管的节目面板从默认值起步，只在与默认不同时才下发。
  renderer.setRenderCache([])
  const settled = renderer.replaceContent(document).then(() => Promise.all([renderer.setRenderDivisor(1), renderer.setSpaceDisplay('realtime'), renderer.setWebDisplayScale(1)])).then(() => true, error => {
    logger.warn('节目会话放下素材失败，改为回收', { event: 'video_edit.program.pool.park_failed', error, context: { projectId } })
    if (parked.get(projectId)?.entry === entry) void releaseParked(projectId, 'park-failed')
    return false
  })
  parked.set(projectId, { entry, ownerDocument: options.ownerDocument, alive: options.alive, settled })
  for (const oldest of [...parked.keys()].slice(0, Math.max(0, parked.size - PARKED_LIMIT))) void releaseParked(oldest, 'parked-limit')
  logger.info('节目会话已保留', { event: 'video_edit.program.pool.parked', context: { projectId } })
  watchMemory()
}

/** 保留的会话还能不能接管；不能时给出回收原因。 */
async function parkedUnusableReason(kept: Parked, ownerDocument: Document | undefined): Promise<string | undefined> {
  if (!await kept.settled) return 'park-failed'
  if (kept.entry.renderer.terminated) return 'session-terminated'
  if (!kept.alive()) return 'project-closed'
  // 弹出窗口与主窗口各有自己的画布宿主，转移过的画布不跨窗口复用。
  if (ownerDocument && kept.ownerDocument !== ownerDocument) return 'owner-changed'
  if (!await sameNativeStatus(kept.entry)) return 'native-status-changed'
  if (!await kept.entry.renderer.prepareGpu().then(() => true, () => false)) return 'device-lost'
  return undefined
}
/** Ownership moves to the visible monitor. A used project session only returns to the same project. */
export async function takeVideoEditProgram(projectId: string, sequenceId: string, ownerDocument?: Document): Promise<Program | undefined> {
  const kept = parked.get(projectId)
  if (kept) {
    parked.delete(projectId); stopWatchingMemory()
    const reason = await parkedUnusableReason(kept, ownerDocument)
    if (!reason) {
      const timing = videoEditTimingContext(projectId, sequenceId)
      if (timing) videoEditTimingEvent(timing, 'render.session.reused', {})
      logger.info('节目会话直接复用', { event: 'video_edit.program.pool.reused', context: { projectId } })
      return kept.entry
    }
    // 新会话要等旧会话把 GPU 与缓存交出来。
    await release(kept.entry, reason)
  }
  const entry = spare
  if (!entry) return
  if (entry.renderer.terminated) { retire('session-terminated'); return }
  spare = undefined
  if (!await sameNativeStatus(entry)) { void release(entry, 'native-status-changed'); return }
  entry.renderer.adoptProject(projectId)
  const timing = videoEditTimingContext(projectId, sequenceId)
  if (timing) videoEditTimingEvent(timing, 'render.session.adopted', { ready: entry.ready })
  return entry
}
/** 会话能否用原生解码在建立时就定下了；之后服务可能已崩溃、被移除或恢复，接管前按此刻的状态核对，不一致就新建会话。 */
async function sameNativeStatus(entry: Program): Promise<boolean> {
  const [prepared, status] = await Promise.all([entry.renderer.nativeDecoding(), Promise.resolve().then(() => getPlatform().videoDecoder.status()).catch(() => undefined)])
  return prepared === (status ? videoEditNativeDecoding(status) : false)
}
