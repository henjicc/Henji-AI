import type { VideoEditComposition } from '@/core/videoEdit/document'
import { createLogger } from '@/core/logging'
import { getPlatform } from '@/platform/runtime'
import type { VideoEditRenderSession } from './videoEditRenderSession'

const logger = createLogger('features.videoEdit.offscreenPool')
export interface VideoEditOffscreenLease {
  session: VideoEditRenderSession
  reused: boolean
  release(discard?: boolean): Promise<void>
}

/** One exclusive document lease, including update, sampling and bitmap ownership.
 * Export/audio/trackers keep independent sessions: their long streams must not block observations. */
export class VideoEditOffscreenPool {
  private session?: VideoEditRenderSession
  private tail: Promise<void> = Promise.resolve()
  private idle?: ReturnType<typeof setTimeout>
  private memoryTimer?: ReturnType<typeof setInterval>
  private active = false
  private retiring: Promise<void> = Promise.resolve()
  constructor(
    private readonly create?: (document: VideoEditComposition) => Promise<VideoEditRenderSession>,
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
      const reused = !!this.session
      if (!this.session) {
        if (!create) throw new Error('离屏渲染尚未提供会话构造器。')
        this.session = await create(document)
      }
      const session = this.session
      if (reused) await Promise.race([session.replaceContent(document), cancelled])
      signal.throwIfAborted()
      let released = false
      return { session, reused, release: async (discard = false) => {
        if (released) return
        released = true
        try {
          if (discard) await this.retire('request-failed')
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
