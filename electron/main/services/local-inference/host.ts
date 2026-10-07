import type { LocalInferenceEvent, LocalInferenceFailureCode, LocalInferenceRequest, SmartRegionAnalysisJob, SmartRegionAnalysisResult } from './protocol'
import type { TrackingCandidatesJob, TrackingCandidatesResult, TrackingJob, TrackingJobResult } from './tracking/trackingProtocol'
import { assertTrackingFrames, type TrackingFrameProvider } from '../../../../src/platform/contracts/tracking'

/*
 * 主进程侧的本地推理宿主：按需启动后台进程（utility process），派发分析、转发进度与日志、取消；
 * 空闲一段时间后结束进程，释放显存与模型内存。进程意外退出时，进行中的分析以失败结束，下次分析重新启动进程。
 */

export interface LocalInferenceChild {
  postMessage(message: LocalInferenceRequest): void
  on(event: 'message', listener: (message: LocalInferenceEvent) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  kill(): boolean
}

export class LocalInferenceFailure extends Error {
  constructor(readonly code: LocalInferenceFailureCode, message: string) { super(message); this.name = 'LocalInferenceFailure' }
}

export interface LocalInferenceHostOptions {
  fork: () => LocalInferenceChild
  log: (level: 'info' | 'warn' | 'error', message: string, event: string, context: Record<string, unknown>) => void
  idleMs?: number
}

interface Pending { resolve(value: unknown): void; reject(error: Error): void; progress(done: number, total: number): void; frames?: TrackingFrameProvider; controller: AbortController; framePending: boolean }

export class LocalInferenceHost {
  private child?: LocalInferenceChild
  private readonly pending = new Map<string, Pending>()
  private idleTimer?: ReturnType<typeof setTimeout>
  private disposed = false
  constructor(private readonly options: LocalInferenceHostOptions) {}

  private ensureChild(): LocalInferenceChild {
    if (this.child) return this.child
    const child = this.options.fork()
    this.child = child
    this.options.log('info', '本地推理进程已启动', 'local_inference.process.started', {})
    child.on('message', (message) => {
      if (message.type === 'log') { this.options.log(message.level, message.message, message.event, message.context); return }
      const entry = this.pending.get(message.id)
      if (!entry) return
      if (message.type === 'frames') {
        void (async () => {
          let frames: Uint8Array[] = []; let error: string | undefined; let ownsFrameRequest = false
          try {
            if (!entry.frames || entry.framePending) throw new Error('跟踪取帧来源不可用或请求过多。')
            entry.framePending = true; ownsFrameRequest = true
            frames = await entry.frames(message.id, message.request, entry.controller.signal)
            assertTrackingFrames(message.request, frames)
          } catch (failure) { error = failure instanceof Error ? failure.message.slice(0, 300) : '跟踪取帧失败。' }
          finally { if (ownsFrameRequest) entry.framePending = false }
          if (this.child === child && this.pending.get(message.id) === entry) child.postMessage({ type: 'frames', id: message.id, reply: { id: message.requestId, frames: error ? [] : frames, ...(error ? { error } : {}) } })
        })()
        return
      }
      if (message.type === 'progress') { entry.progress(message.done, message.total); return }
      this.pending.delete(message.id)
      entry.controller.abort()
      if (message.type === 'done') entry.resolve(message.result)
      else entry.reject(new LocalInferenceFailure(message.code, message.message))
      this.scheduleIdle()
    })
    child.on('exit', (code) => {
      if (this.child !== child) return
      this.child = undefined
      const interrupted = [...this.pending.values()]; this.pending.clear()
      for (const entry of interrupted) { entry.controller.abort(); entry.reject(new LocalInferenceFailure('inference', '本地推理进程意外退出。')) }
      if (interrupted.length) this.options.log('error', '本地推理进程意外退出', 'local_inference.process.exited', { code, interrupted: interrupted.length })
    })
    return child
  }

  private scheduleIdle(): void {
    clearTimeout(this.idleTimer)
    if (this.pending.size || !this.child) return
    this.idleTimer = setTimeout(() => {
      if (this.pending.size || !this.child) return
      const child = this.child; this.child = undefined
      child.kill()
      this.options.log('info', '本地推理进程空闲退出', 'local_inference.process.idle_exit', {})
    }, this.options.idleMs ?? 60_000)
  }

  analyze(job: SmartRegionAnalysisJob, progress: (done: number, total: number) => void = () => undefined): Promise<SmartRegionAnalysisResult> {
    return this.send<SmartRegionAnalysisResult>({ type: 'analyze', job }, job.id, progress)
  }

  /** 跟踪（4.10）：与分析同一个后台进程、同一个队列（显卡与解码都是独占负载）。 */
  track(job: TrackingJob, progress: (done: number, total: number) => void = () => undefined, frames?: TrackingFrameProvider): Promise<TrackingJobResult> {
    return this.send<TrackingJobResult>({ type: 'track', job }, job.id, progress, frames)
  }

  candidates(job: TrackingCandidatesJob, frames?: TrackingFrameProvider): Promise<TrackingCandidatesResult> {
    return this.send<TrackingCandidatesResult>({ type: 'candidates', job }, job.id, () => undefined, frames)
  }

  private send<T>(request: LocalInferenceRequest, id: string, progress: (done: number, total: number) => void, frames?: TrackingFrameProvider): Promise<T> {
    if (this.disposed) return Promise.reject(new LocalInferenceFailure('cancelled', '本地推理已关闭。'))
    clearTimeout(this.idleTimer)
    const child = this.ensureChild()
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: value => resolve(value as T), reject, progress, frames, controller: new AbortController(), framePending: false })
      child.postMessage(request)
    })
  }

  cancel(id: string): void { const entry = this.pending.get(id); if (entry) { entry.controller.abort(); this.child?.postMessage({ type: 'cancel', id }) } }

  dispose(): void {
    this.disposed = true
    clearTimeout(this.idleTimer)
    for (const entry of this.pending.values()) { entry.controller.abort(); entry.reject(new LocalInferenceFailure('cancelled', '本地推理已关闭。')) }
    this.pending.clear()
    this.child?.kill(); this.child = undefined
  }
}
