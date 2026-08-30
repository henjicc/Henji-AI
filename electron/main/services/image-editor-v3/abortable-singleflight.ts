interface SharedJob<T> {
  readonly controller: AbortController
  readonly promise: Promise<T>
  waiters: number
  settled: boolean
}

export function imageSourceAbortError(): Error {
  const error = new Error('Image source operation was cancelled')
  error.name = 'AbortError'
  return error
}

export function throwIfImageSourceAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw imageSourceAbortError()
}

/**
 * 同键工作只执行一次；每个等待者独立取消，最后一个等待者离开时才取消底层工作。
 */
export class AbortableSingleflight<T> {
  private readonly jobs = new Map<string, SharedJob<T>>()

  run(
    key: string,
    producer: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    throwIfImageSourceAborted(signal)
    let job = this.jobs.get(key)
    if (job?.controller.signal.aborted && job.waiters === 0) {
      if (this.jobs.get(key) === job) this.jobs.delete(key)
      job = undefined
    }
    if (!job) {
      const controller = new AbortController()
      const promise = Promise.resolve().then(() => producer(controller.signal))
      job = { controller, promise, waiters: 0, settled: false }
      this.jobs.set(key, job)
      const createdJob = job
      void promise.then(
        () => this.finishJob(key, createdJob),
        () => this.finishJob(key, createdJob),
      )
    }
    return this.waitForJob(job, signal)
  }

  private finishJob(key: string, job: SharedJob<T>): void {
    job.settled = true
    if (this.jobs.get(key) === job) this.jobs.delete(key)
  }

  private waitForJob(job: SharedJob<T>, signal?: AbortSignal): Promise<T> {
    job.waiters += 1
    return new Promise<T>((resolve, reject) => {
      let finished = false
      const finishWaiter = (): { lastActiveWaiter: boolean } | null => {
        if (finished) return null
        finished = true
        signal?.removeEventListener('abort', onAbort)
        job.waiters -= 1
        return { lastActiveWaiter: job.waiters === 0 && !job.settled }
      }
      const onAbort = (): void => {
        const finishedWaiter = finishWaiter()
        if (!finishedWaiter) return
        if (!finishedWaiter.lastActiveWaiter) {
          reject(imageSourceAbortError())
          return
        }
        job.controller.abort()
        // 最后一个等待者仍等底层原子瓦片/pass 停止，避免调用方提前释放 source lease。
        void job.promise.then(
          () => reject(imageSourceAbortError()),
          () => reject(imageSourceAbortError()),
        )
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) {
        onAbort()
        return
      }
      void job.promise.then(
        (value) => {
          if (finishWaiter()) resolve(value)
        },
        (error: unknown) => {
          if (finishWaiter()) reject(error)
        },
      )
    })
  }
}
