import type { ExtractAudioSamplesResultDto, AudioWaveformRangeResult } from './types'

type Result = ExtractAudioSamplesResultDto | AudioWaveformRangeResult
interface Job {
  key: string
  controller: AbortController
  users: number
  task: (signal: AbortSignal) => Promise<Result>
  cacheable: boolean
  promise: Promise<Result>
  resolve: (value: Result) => void
  reject: (error: unknown) => void
}

function byteSize(key: string, result: Result): number {
  return 256 + key.length * 2 + ('channels' in result
    ? 2 * (result.fileIdentity.length + (result.sourceRevision?.length ?? 0)) + result.channels.reduce((sum, channel) => sum + 128 + 8 * (channel.peak.length + channel.rms.length + channel.sampleCounts.length), 0)
    : 128 + 8 * (result.peak.length + result.rms.length))
}

/** One queue/cache shared by legacy overview and range consumers. Native task settles only after close. */
export class AudioWaveformQueue {
  private readonly jobs = new Map<string, Job>()
  private readonly waiting: Job[] = []
  private readonly running = new Set<Job>()
  private readonly cache = new Map<string, { value: Result; bytes: number }>()
  private cacheBytes = 0
  private active = 0
  private disposed = false
  private disposePromise?: Promise<void>
  constructor(private readonly budgetBytes = 64 * 1024 * 1024) {}
  get statistics(): { active: number; queued: number; cacheBytes: number; cacheEntries: number } {
    return { active: this.active, queued: this.waiting.length, cacheBytes: this.cacheBytes, cacheEntries: this.cache.size }
  }
  run<T extends Result>(key: string, task: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal, cacheable = true): Promise<T> {
    signal?.throwIfAborted()
    if (this.disposed) throw new Error('音频波形服务已关闭。')
    const cached = cacheable ? this.cache.get(key) : undefined
    if (cached) {
      this.cache.delete(key); this.cache.set(key, cached)
      return Promise.resolve(structuredClone(cached.value) as T)
    }
    let job = this.jobs.get(key)
    if (job?.controller.signal.aborted) job = undefined
    if (!job) {
      if (this.active >= 2 && this.waiting.length >= 32) throw new Error('音频波形排队已满，请稍后重试。')
      let resolve!: Job['resolve']; let reject!: Job['reject']
      const promise = new Promise<Result>((done, fail) => { resolve = done; reject = fail })
      // The consumer may leave before native close; keep the job rejection observed.
      void promise.catch(() => undefined)
      job = { key, controller: new AbortController(), users: 0, task, cacheable, promise, resolve, reject }
      this.jobs.set(key, job); this.waiting.push(job)
    }
    const owned = job
    owned.users++
    const result = new Promise<T>((resolve, reject) => {
      let settled = false
      const leave = (): void => {
        owned.users--
        signal?.removeEventListener('abort', onAbort)
        owned.controller.signal.removeEventListener('abort', onJobAbort)
        if (!owned.users) {
          owned.controller.abort(new DOMException('操作已取消', 'AbortError'))
          const index = this.waiting.indexOf(owned)
          if (index >= 0) {
            this.waiting.splice(index, 1)
            if (this.jobs.get(key) === owned) this.jobs.delete(key)
            owned.reject(owned.controller.signal.reason)
          }
        }
      }
      const complete = (action: () => void): void => { if (settled) return; settled = true; leave(); action() }
      const onAbort = (): void => complete(() => reject(signal?.reason ?? new DOMException('操作已取消', 'AbortError')))
      const onJobAbort = (): void => complete(() => reject(owned.controller.signal.reason))
      signal?.addEventListener('abort', onAbort, { once: true })
      owned.controller.signal.addEventListener('abort', onJobAbort, { once: true })
      if (signal?.aborted) onAbort()
      owned.promise.then(value => complete(() => resolve(structuredClone(value) as T)), error => complete(() => reject(error)))
    })
    this.pump()
    return result
  }
  private pump(): void {
    while (!this.disposed && this.active < 2 && this.waiting.length) {
      const job = this.waiting.shift()!
      this.active++
      this.running.add(job)
      void Promise.resolve().then(() => { job.controller.signal.throwIfAborted(); return job.task(job.controller.signal) }).then(value => {
        if (job.controller.signal.aborted) { job.reject(job.controller.signal.reason); return }
        const bytes = byteSize(job.key, value)
        if (job.cacheable && bytes <= this.budgetBytes) {
          const previous = this.cache.get(job.key)
          if (previous) { this.cacheBytes -= previous.bytes; this.cache.delete(job.key) }
          while (this.cacheBytes + bytes > this.budgetBytes && this.cache.size) {
            const key = this.cache.keys().next().value as string
            this.cacheBytes -= this.cache.get(key)!.bytes; this.cache.delete(key)
          }
          this.cache.set(job.key, { value: structuredClone(value), bytes }); this.cacheBytes += bytes
        }
        job.resolve(value)
      }, job.reject).catch(job.reject).finally(() => {
        if (this.jobs.get(job.key) === job) this.jobs.delete(job.key)
        this.running.delete(job)
        this.active--; this.pump()
      })
    }
  }
  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise
    this.disposed = true
    const jobs = [...new Set([...this.jobs.values(), ...this.running])]
    for (const job of jobs) job.controller.abort(new DOMException('操作已取消', 'AbortError'))
    for (const job of this.waiting.splice(0)) { this.jobs.delete(job.key); job.reject(job.controller.signal.reason) }
    this.cache.clear(); this.cacheBytes = 0
    this.disposePromise = Promise.allSettled(jobs.map(job => job.promise)).then(() => undefined)
    return this.disposePromise
  }
}
