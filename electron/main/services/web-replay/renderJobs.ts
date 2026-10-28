import type { WebReplayCancelTarget, WebReplayJobState, WebReplayRenderResult } from '../../../../src/platform/contracts/webReplay'
import { createMainLogger } from '../logging'

const logger = createMainLogger('main.web_replay.jobs')

/** 结束的任务留多少个：账本恢复只需要最近的结果，重启后本来就不保留。 */
const KEPT_SETTLED_JOBS = 100

export interface WebReplayJobSnapshot {
  jobId: string
  recordingId: string
  state: WebReplayJobState
  progress: number
  result?: WebReplayRenderResult
  error?: { name: string; message: string }
}

interface Job extends WebReplayJobSnapshot { controller: AbortController; settled: Promise<void>; settle: () => void }

function namedError(name: string, message: string): Error {
  const error = new Error(message)
  error.name = name
  return error
}

/**
 * 网页重演任务登记：结果、进度和取消控制都在主进程，渲染层重载不影响它们。只放内存，应用重启后
 * 没跑完的重演本来就不在了。每段录制同一时间最多一个未结束的任务。
 */
export class WebReplayRenderJobs {
  private readonly jobs = new Map<string, Job>()
  private readonly listeners = new Set<(job: WebReplayJobSnapshot) => void>()
  /** 由应用运行时提供：把任务标识换成调用方查得到的操作 ID，写进重复提交的拒绝里。 */
  private ownerOf: (jobId: string) => string | undefined = () => undefined

  setOwnerResolver(resolve: (jobId: string) => string | undefined): void { this.ownerOf = resolve }
  onSettled(listener: (job: WebReplayJobSnapshot) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }

  get(jobId: string): WebReplayJobSnapshot | undefined { const job = this.jobs.get(jobId); return job && snapshot(job) }
  active(recordingId: string): WebReplayJobSnapshot | undefined { const job = this.activeJob(recordingId); return job && snapshot(job) }

  /** 登记一次新的重演；这段录制已有未结束的任务时拒绝，并点名原操作。 */
  begin(jobId: string, recordingId: string): { signal: AbortSignal } {
    const running = this.activeJob(recordingId) ?? [...this.jobs.values()].find(job => job.jobId === jobId && !finished(job.state))
    if (running) {
      const owner = this.ownerOf(running.jobId)
      throw namedError('WebReplayBusyError', `这段网页录制正在重演（${owner ? `原操作 operationId=${owner}` : `原重演任务 ${running.jobId}`}）。用 get_application_operation 查询原操作的结果，或用 cancel_web_app_replay 取消后再提交；没有重演新的一遍。`)
    }
    let settle!: () => void
    const settled = new Promise<void>(resolve => { settle = resolve })
    const job: Job = { jobId, recordingId, state: 'queued', progress: 0, controller: new AbortController(), settled, settle }
    // 同一操作标识在“未执行”后重试会复用 jobId：旧的已结束，直接换成新的一次。
    this.jobs.delete(jobId)
    this.jobs.set(jobId, job)
    return { signal: job.controller.signal }
  }

  running(jobId: string): void { const job = this.jobs.get(jobId); if (job?.state === 'queued') job.state = 'running' }
  progress(jobId: string, progress: number): void { const job = this.jobs.get(jobId); if (job && !finished(job.state)) job.progress = progress }
  complete(jobId: string, result: WebReplayRenderResult): void { this.finish(jobId, { state: 'completed', progress: 1, result }) }
  fail(jobId: string, error: unknown): void {
    const failure = error instanceof Error ? error : new Error(String(error))
    this.finish(jobId, { state: failure.name === 'WebReplayCancelledError' ? 'cancelled' : 'failed', error: { name: failure.name, message: failure.message } })
  }

  /** 排队中的直接离开队列，正在跑的让播放器停下；等它真正结束（最多 `waitMs`）再返回结束后的状态。 */
  async cancel(target: WebReplayCancelTarget, waitMs = 15_000): Promise<{ job: WebReplayJobSnapshot; previousState: 'queued' | 'running' }> {
    const job = 'jobId' in target ? this.jobs.get(target.jobId) : this.activeJob(target.recordingId)
    if (!job || finished(job.state)) throw namedError('WebReplayJobNotFoundError', 'jobId' in target ? '这次重演已经结束，没有可取消的。' : '这段网页录制没有排队中或正在进行的重演。')
    const previousState = job.state as 'queued' | 'running'
    job.controller.abort()
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([job.settled, new Promise<void>(resolve => { timer = setTimeout(resolve, waitMs) })])
    clearTimeout(timer)
    return { job: snapshot(job), previousState }
  }

  private activeJob(recordingId: string): Job | undefined { return [...this.jobs.values()].find(job => job.recordingId === recordingId && !finished(job.state)) }

  private finish(jobId: string, fields: Pick<WebReplayJobSnapshot, 'state'> & Partial<WebReplayJobSnapshot>): void {
    const job = this.jobs.get(jobId)
    if (!job || finished(job.state)) return
    Object.assign(job, fields)
    job.settle()
    this.prune()
    const value = snapshot(job)
    // 记账失败只影响账本，不能把已经跑完的重演报成失败
    for (const listener of this.listeners) {
      try { listener(value) } catch (error) { logger.warn('网页重演结束的通知没能处理', { event: 'web_replay.job.listener_failed', context: { jobId, state: value.state }, error: String(error) }) }
    }
  }

  private prune(): void {
    const settled = [...this.jobs.values()].filter(job => finished(job.state))
    for (const job of settled.slice(0, Math.max(0, settled.length - KEPT_SETTLED_JOBS))) this.jobs.delete(job.jobId)
  }
}

const finished = (state: WebReplayJobState): boolean => state === 'completed' || state === 'failed' || state === 'cancelled'
function snapshot(job: Job): WebReplayJobSnapshot {
  return { jobId: job.jobId, recordingId: job.recordingId, state: job.state, progress: job.progress, ...(job.result ? { result: job.result } : {}), ...(job.error ? { error: job.error } : {}) }
}

export const webReplayRenderJobs = new WebReplayRenderJobs()
