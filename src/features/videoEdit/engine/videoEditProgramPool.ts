import { createVideoEditSequence, type VideoEditComposition } from '@/core/videoEdit/document'
import { createLogger } from '@/core/logging'
import { getPlatform } from '@/platform/runtime'
import { VideoEditRenderSession } from './videoEditRenderSession'
import { videoEditTimingContext, videoEditTimingEvent } from './videoEditFirstFrameTiming'

const logger = createLogger('features.videoEdit.programPool')
type Program = { surface: HTMLCanvasElement; renderer: VideoEditRenderSession; document: VideoEditComposition; ready: boolean }
let spare: Program | undefined
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
function retire(reason: string): void {
  const previous = spare; spare = undefined
  if (!previous) return
  logger.info('空闲节目会话已回收', { event: 'video_edit.program.pool.released', context: { reason } })
  void previous.renderer.dispose()
}
async function checkMemoryAndPrepare(): Promise<void> {
  if (checking) return checking
  checking = (async () => {
    // Physical available memory, not the renderer's JS heap. Never retain speculative GPU work under pressure.
    const memory = await getPlatform().system.memoryInfo()
    if (memory.availableBytes < Math.max(512 * 1024 ** 2, memory.totalBytes * 0.05)) { retire('memory-pressure'); return }
    if (spare) {
      const entry = spare
      if (entry.ready) await entry.renderer.prepareGpu().catch(error => {
        if (spare === entry) { preparationFailed = true; retire('device-unavailable'); logger.warn('空闲节目设备已失效，打开时重新准备', { event: 'video_edit.program.pool.failed', error }) }
      })
      return
    }
    if (!owners || preparationFailed) return
    const sequence = { ...createVideoEditSequence('节目准备'), width: 32, height: 32 }
    const document: VideoEditComposition = { ...sequence, fps: 30, revision: 0, media: [], items: [] }
    const surface = createVideoEditProgramSurface(32, 32)
    const entry: Program = { surface, document, renderer: new VideoEditRenderSession(document, 32, undefined, surface.transferControlToOffscreen()), ready: false }
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
  memoryTimer ??= setInterval(() => { void checkMemoryAndPrepare() }, 5000)
  let released = false
  return () => {
    if (released) return
    released = true
    if (--owners) return
    releaseTimer = setTimeout(() => {
      retire('workspace-left'); clearInterval(memoryTimer); memoryTimer = undefined
    }, 5000)
  }
}

/** Ownership moves to the visible monitor. A used project session never returns to this pool. */
export function takeVideoEditProgram(projectId: string, sequenceId: string): Program | undefined {
  const entry = spare
  if (!entry) return
  if (entry.renderer.terminated) { retire('session-terminated'); return }
  spare = undefined
  entry.renderer.adoptProject(projectId)
  const timing = videoEditTimingContext(projectId, sequenceId)
  if (timing) videoEditTimingEvent(timing, 'render.session.adopted', { ready: entry.ready })
  return entry
}
