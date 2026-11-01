import type { MainLogger } from '../logging/main-logger'

export interface WebCacheSubmissionPermit { current(): boolean; release(): Promise<void> }

/** 仅取消调用方等待，底层工作继续完成清理并维持原有串行屏障。 */
export function waitWebCacheTask<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work
  return new Promise((resolve, reject) => {
    const cancel = (): void => { signal.removeEventListener('abort', cancel); reject(signal.reason) }
    if (signal.aborted) cancel()
    else signal.addEventListener('abort', cancel, { once: true })
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel))
  })
}

/** 暂停只拦住新提交；页面、编码器、纹理与段锁仍由原任务持有。 */
export class WebCacheSubmissions {
  private readonly holds = new Set<symbol>()
  private readonly waiters = new Set<() => void>()
  private readonly draining = new Set<() => void>()
  private active = 0
  private submitted = 0
  private completed = 0
  private pausedAt = 0

  constructor(private readonly logger: Pick<MainLogger, 'info'>,
    private readonly coordinator?: { acquire(signal?: AbortSignal): Promise<WebCacheSubmissionPermit> }) {}

  get state(): { paused: boolean; active: number; submitted: number; completed: number } {
    return { paused: this.holds.size > 0, active: this.active, submitted: this.submitted, completed: this.completed }
  }

  hold(reason: string): { drained: Promise<void>; resume: () => void } {
    const token = Symbol(reason)
    if (!this.holds.size) {
      this.pausedAt = performance.now()
      this.logger.info('网页补录停止新提交，保留当前会话', { event: 'web_source.record.preempted', context: { reason, active: this.active, submitted: this.submitted } })
    }
    this.holds.add(token)
    return {
      drained: this.active === 0 ? Promise.resolve() : new Promise(resolve => { this.draining.add(resolve) }),
      resume: () => {
        if (!this.holds.delete(token) || this.holds.size) return
        this.logger.info('网页补录继续使用已保留的会话', { event: 'web_source.record.resumed', context: { pausedMs: performance.now() - this.pausedAt, submitted: this.submitted } })
        for (const wake of [...this.waiters]) wake()
      },
    }
  }

  async run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    for (;;) {
      while (this.holds.size) {
        signal?.throwIfAborted()
        await new Promise<void>((resolve, reject) => {
          const clear = (): void => { this.waiters.delete(wake); signal?.removeEventListener('abort', abort) }
          const wake = (): void => { clear(); resolve() }
          const abort = (): void => { clear(); reject(signal?.reason) }
          this.waiters.add(wake)
          signal?.addEventListener('abort', abort, { once: true })
        })
      }
      signal?.throwIfAborted()
      const permit = this.coordinator ? await this.coordinator.acquire(signal) : undefined
      if (permit && (this.holds.size || !permit.current() || signal?.aborted)) {
        await permit.release()
        signal?.throwIfAborted()
        continue
      }
      // 最后一次暂停检查与调用 work 之间没有 await，恢复同一轮中的再次抢占也不会漏提交。
      this.active++; this.submitted++
      try { return await work() }
      finally {
        this.active--; this.completed++
        if (!this.active) { for (const done of this.draining) done(); this.draining.clear() }
        await permit?.release()
      }
    }
  }
}
