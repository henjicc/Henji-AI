import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { VideoDecoderService } from '../video-decoder/client'
import type { VideoFrameTarget } from '../video-decoder/texture-bridge'
import type { MainLogger } from '../logging/main-logger'
import type { WebCacheSubmissionPermit } from './submissions'

type Service = Pick<VideoDecoderService, 'ensureStarted' | 'onLifecycle' | 'webCacheForeground' | 'webCacheSubmission' | 'webCacheSubmissionRelease'>

/** 前台事实按宿主生命周期持有；跨实例额度只覆盖一次已提交工作，等待暂停期间不占额度。 */
export class WebCacheActivity {
  private readonly targets = new Map<number, { active: boolean; stop: () => void }>()
  private transient = 0
  private generation = 0
  private tail: Promise<void> = Promise.resolve()
  private readonly stop: () => void
  private disposed = false
  private retry?: ReturnType<typeof setTimeout>

  constructor(private readonly service: Service, private readonly logger: Pick<MainLogger, 'warn'>) {
    this.stop = service.onLifecycle(event => {
      if (event.type === 'exited') this.generation++
      if (event.type === 'ready') this.syncInBackground()
    })
  }

  get active(): boolean { return this.transient > 0 || [...this.targets.values()].some(target => target.active) }

  setForeground(target: VideoFrameTarget, active: boolean): Promise<void> {
    if (this.disposed || target.isDestroyed()) return Promise.resolve()
    let entry = this.targets.get(target.id)
    if (!entry) {
      entry = { active, stop: () => undefined }
      this.targets.set(target.id, entry)
      const held = entry
      entry.stop = target.onGone(() => {
        if (this.targets.get(target.id) !== held) return
        this.targets.delete(target.id); held.stop(); this.syncInBackground()
      })
    }
    entry.active = active
    return this.sync()
  }

  async foreground<T>(work: () => Promise<T>): Promise<T> {
    this.transient++
    try {
      // 协调失败只停补录，不能让实时取帧失败。
      await this.sync().catch(error => this.failed(error))
      return await work()
    } finally { this.transient--; this.syncInBackground() }
  }

  private sync(): Promise<void> {
    const next = this.tail.catch(() => undefined).then(async () => {
      if (this.disposed) return
      await this.service.ensureStarted()
      await this.service.webCacheForeground(this.active)
    })
    this.tail = next
    return next
  }

  private syncInBackground(): void { void this.sync().catch(error => this.failed(error)) }
  private failed(error: unknown): void {
    this.logger.warn('网页补录活动协调不可用，继续实时渲染', { event: 'web_source.activity.failed', error })
    if (!this.disposed && !this.retry) this.retry = setTimeout(() => { this.retry = undefined; this.syncInBackground() }, 1000)
  }

  async acquire(signal?: AbortSignal): Promise<WebCacheSubmissionPermit> {
    for (;;) {
      signal?.throwIfAborted()
      if (this.disposed) throw new Error('网页补录活动协调已关闭')
      if (this.active) { await delay(25, undefined, { signal }); continue }
      await this.sync()
      const generation = this.generation, lease = randomUUID()
      let keep = false
      try {
        const result = await this.service.webCacheSubmission(lease)
        signal?.throwIfAborted()
        if (generation !== this.generation) throw new Error('网页补录提交所属进程已退出')
        if (result.acquired && !this.active) {
          keep = true
          return {
            current: () => !this.disposed && !this.active && generation === this.generation,
            release: async () => { if (generation === this.generation) await this.service.webCacheSubmissionRelease(lease) },
          }
        }
      } finally {
        // 回复取消或超时仍按同 token 释放；服务重启后不把旧租约送进新进程。
        if (!keep && generation === this.generation) await this.service.webCacheSubmissionRelease(lease)
      }
      await delay(25, undefined, { signal })
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    clearTimeout(this.retry)
    for (const target of this.targets.values()) target.stop()
    this.targets.clear()
    this.stop()
    await this.tail.catch(() => undefined)
    await this.service.webCacheForeground(false)
  }
}
