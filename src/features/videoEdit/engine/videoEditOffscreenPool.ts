import type { VideoEditComposition } from '@/core/videoEdit/document'
import { createLogger } from '@/core/logging'
import { getPlatform } from '@/platform/runtime'
import type { VideoEditRenderTransport } from './videoEditRenderTransport'
import { VideoEditRenderWorkerError } from './videoEditGpuFailure'

const logger = createLogger('features.videoEdit.offscreenPool')
export interface VideoEditOffscreenLease {
  session: VideoEditRenderTransport
  reused: boolean
  run<T>(document: VideoEditComposition, operation: (session: VideoEditRenderTransport) => Promise<T>): Promise<T>
  release(discard?: boolean): Promise<void>
}

/** One exclusive document lease, including update, sampling and bitmap ownership.
 * Export/audio/trackers keep independent sessions: their long streams must not block observations. */
export class VideoEditOffscreenPool {
  private session?: VideoEditRenderTransport
  private tail: Promise<void> = Promise.resolve()
  private idle?: ReturnType<typeof setTimeout>
  private memoryTimer?: ReturnType<typeof setInterval>
  private active = false
  private retiring: Promise<void> = Promise.resolve()
  constructor(
    private readonly create?: (document: VideoEditComposition) => Promise<VideoEditRenderTransport>,
    private readonly memoryAvailable: () => Promise<boolean> = async () => {
      const memory = await getPlatform().system.memoryInfo()
      return memory.availableBytes >= Math.max(512 * 1024 ** 2, memory.totalBytes * .05)
    },
    private readonly idleMs = 60_000,
  ) {}

  async acquire(document: VideoEditComposition, signal: AbortSignal, create = this.create): Promise<VideoEditOffscreenLease> {
    signal.throwIfAborted()
    const previous = this.tail
    let unlock!: () => void
    this.tail = new Promise(resolve => { unlock = resolve })
    let cancel!: () => void
    const cancelled = new Promise<never>((_, reject) => {
      cancel = () => reject(signal.reason)
      signal.addEventListener('abort', cancel, { once: true })
    })
    let acquired = false
    try {
      await Promise.race([previous, cancelled]); acquired = true
      signal.throwIfAborted()
      clearTimeout(this.idle); clearInterval(this.memoryTimer)
      this.active = true
      await Promise.race([this.retiring, cancelled])
      // A failed memory query is conservative for retention, not a failed user operation.
      if (!await Promise.race([this.memoryAvailable().catch(() => false), cancelled])) await this.retire('memory-pressure')
      signal.throwIfAborted()
      if (this.session?.terminated) await this.retire('session-terminated')
      let reused = !!this.session
      if (!this.session) {
        if (!create) throw new Error('离屏渲染尚未提供会话构造器。')
        this.session = await create(document)
      }
      let session = this.session
      if (reused) {
        try { await Promise.race([session.replaceContent(document), cancelled]) }
        catch (error) {
          if (!(error instanceof VideoEditRenderWorkerError) || signal.aborted || !create) throw error
          await this.retire('worker-failed')
          signal.throwIfAborted()
          session = this.session = await create(document); reused = false
        }
      }
      signal.throwIfAborted()
      let released = false
      let recoveries = 0
      return { get session() { return session }, reused, run: async <T>(document: VideoEditComposition, operation: (session: VideoEditRenderTransport) => Promise<T>): Promise<T> => {
        let recovering = false
        for (;;) {
          signal.throwIfAborted()
          if (released) throw new Error('离屏画面任务已结束。')
          try {
            const result = await operation(session)
            if (recovering) logger.info('离屏画面已恢复', { event: 'video_edit.offscreen.recover.completed', context: { sequenceId: document.id, attempts: recoveries } })
            return result
          }
          catch (error) {
            // 只重放尚未交出的只读画面操作；作者超时和正常业务错误交给调用方处理。
            if (!(error instanceof VideoEditRenderWorkerError) || signal.aborted || released || !create) throw error
            if (recoveries >= 2) {
              logger.warn('离屏画面自动恢复已停止', { event: 'video_edit.offscreen.recover.failed', error, context: { sequenceId: document.id, attempts: recoveries } })
              throw error
            }
            recovering = true
            const delayMs = 250 * 2 ** recoveries++
            logger.info('重新建立离屏画面', { event: 'video_edit.offscreen.recover.start', context: { sequenceId: document.id, attempt: recoveries, delayMs } })
            await this.retire('worker-failed')
            await new Promise<void>((resolve, reject) => {
              const cancel = (): void => { clearTimeout(timer); reject(signal.reason) }
              const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve() }, delayMs)
              signal.addEventListener('abort', cancel, { once: true })
              if (signal.aborted) { signal.removeEventListener('abort', cancel); cancel() }
            })
            signal.throwIfAborted()
            if (released) throw new Error('离屏画面任务已结束。')
            const next = await create(document)
            if (released || signal.aborted) {
              await next.dispose(); signal.throwIfAborted()
              throw new Error('离屏画面任务已结束。')
            }
            session = this.session = next
          }
        }
      }, release: async (discard = false) => {
        if (released) return
        released = true
        try {
          if (discard || session.terminated) await this.retire('request-failed')
        } finally {
          this.active = false
          this.scheduleRelease()
          unlock()
        }
      } }
    } catch (error) {
      if (acquired) {
        try { await this.retire('acquire-failed') }
        finally { this.active = false; unlock() }
      } else void previous.then(unlock)
      throw error
    } finally { signal.removeEventListener('abort', cancel) }
  }

  private scheduleRelease(): void {
    clearTimeout(this.idle); clearInterval(this.memoryTimer)
    if (!this.session) return
    this.idle = setTimeout(() => { void this.retire('idle') }, this.idleMs)
    this.memoryTimer = setInterval(() => {
      const session = this.session
      void this.memoryAvailable().catch(() => false).then(available => {
        if (!available && !this.active && this.session === session) void this.retire('memory-pressure')
      })
    }, 5000)
  }

  private async retire(reason: string): Promise<void> {
    clearTimeout(this.idle); clearInterval(this.memoryTimer)
    const session = this.session; this.session = undefined
    if (!session) return
    this.retiring = session.dispose().catch(error => logger.warn('离屏会话回收失败', { event: 'video_edit.offscreen.release.failed', error }))
    await this.retiring
    logger.debug('离屏会话已回收', { event: 'video_edit.offscreen.release.completed', context: { reason } })
  }

  /** Test/host shutdown: wait for the owner; never tear down somebody else's request. */
  async dispose(): Promise<void> { await this.tail; await this.retire('shutdown') }
}

export const videoEditOffscreenPool = new VideoEditOffscreenPool()
