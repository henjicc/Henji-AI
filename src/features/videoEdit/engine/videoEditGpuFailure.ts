/** Device loss invalidates every texture and pipeline in the session; decoder fallback cannot repair it. */
export class VideoEditGpuDeviceLostError extends Error {
  readonly code = 'video-edit-gpu-device-lost'
  constructor(readonly detail: string) {
    super('画面处理已中断，请重新加载预览。', { cause: new Error(detail) })
    this.name = 'VideoEditGpuDeviceLostError'
  }
}

export interface VideoEditWorkerDiagnostic { message: string; filename?: string; line?: number; column?: number }

/** Worker 已退出，当前会话的画布与帧通道都不能复用；超时不属于可自动重放的故障。 */
export class VideoEditRenderWorkerError extends Error {
  constructor(message: string, options?: ErrorOptions, readonly diagnostic?: VideoEditWorkerDiagnostic) {
    super(message, options)
    this.name = 'VideoEditRenderWorkerError'
  }

  authorError(): Error {
    const detail = this.diagnostic
    const filename = detail?.filename?.replace(/[?#].*$/, '').split(/[\\/]/).at(-1)
    const location = filename ? `（${filename.slice(0, 256)}${detail?.line ? `:${detail.line}${detail.column ? `:${detail.column}` : ''}` : ''}）` : ''
    // 助手只需要定位代码文件；原始异常的完整路径与堆栈留在日志，不能随 cause 再带出去。
    return new Error(`${(detail?.message || this.message).slice(0, 700)}${location}`)
  }
}

/** 三种监视器共用滚动窗口：30 秒内最多两次自动恢复，显式重试重新计数。 */
export class VideoEditRenderRecovery {
  private times: number[] = []
  get attempts(): number { return this.times.length }
  nextDelay(): number | undefined {
    const now = Date.now()
    this.times = this.times.filter(at => now - at < 30_000)
    if (this.times.length >= 2) return undefined
    this.times.push(now)
    return 250 * 2 ** (this.times.length - 1)
  }
  reset(): void { this.times = [] }
}

interface WorkerErrorScope {
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
  addEventListener(type: 'unhandledrejection', listener: (event: PromiseRejectionEvent) => void): void
  postMessage(message: import('./videoEditWorker').RenderLogMessage): void
}
function errorField(error: unknown, field: 'message' | 'stack'): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  // 作者可以拒绝任意对象，诊断字段的 getter 失败不能制造另一个未捕获异常。
  try {
    const value: unknown = Reflect.get(error, field)
    return typeof value === 'string' ? value : undefined
  } catch { return undefined }
}
function rejectionMessage(reason: unknown): string {
  const message = errorField(reason, 'message')
  if (message !== undefined) return message
  try { return String(reason) }
  catch { return '异步拒绝原因无法转换为文本。' }
}
/** 外部 Worker 的 ErrorEvent 不携带原异常，真实堆栈必须在线程内读取并经既有日志消息送回。 */
export function installVideoEditWorkerErrorReporting(scope: WorkerErrorScope): void {
  let lastRejectionAt = -Infinity
  scope.addEventListener('error', event => {
    const stack = errorField(event.error, 'stack')
    scope.postMessage({ kind: 'log', level: 'warn', message: '剪辑 Worker 未捕获异常', event: 'video_edit.render.worker.uncaught_error', context: { message: event.message, filename: event.filename, line: event.lineno, column: event.colno, ...(stack ? { stack } : {}) } })
  })
  scope.addEventListener('unhandledrejection', event => {
    // 拒绝可能稍后才被处理，也不代表当前帧失败；每秒最多一条，避免作者逐帧泄漏拒绝时刷满日志。
    const now = performance.now()
    if (now - lastRejectionAt < 1000) return
    lastRejectionAt = now
    const stack = errorField(event.reason, 'stack')
    scope.postMessage({ kind: 'log', level: 'warn', message: '剪辑 Worker 未处理的异步异常', event: 'video_edit.render.worker.unhandled_rejection', context: { message: rejectionMessage(event.reason), ...(stack ? { stack } : {}) } })
  })
}

export function videoEditRenderFailure(error: unknown): { error: string; gpuDeviceLost?: string } {
  return { error: error instanceof Error ? error.message : String(error),
    ...(error instanceof VideoEditGpuDeviceLostError ? { gpuDeviceLost: error.detail } : {}) }
}

/**
 * 渲染会话的请求队列已满（背压，不是画面失败）：调用方应少发请求、稍后重试，不能当成渲染失败停播或提示用户。
 * 节目预览在发请求处按在途帧数限流，这个拒绝只是最后一道防线。
 */
export class VideoEditRenderBusyError extends Error {
  readonly code = 'video-edit-render-busy'
  constructor() {
    super('剪辑渲染请求过多。')
    this.name = 'VideoEditRenderBusyError'
  }
}
