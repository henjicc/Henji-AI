/** 后台一轮到了总时限或应用正在退出：未处理的候选原样留在持久队列，下次启动再来。 */
export class MediaRecycleStopped extends Error {
  constructor() { super('Media reclamation stopped'); this.name = 'MediaRecycleStopped' }
}

/** 每次运行只在主界面加载完成后跑一轮后台回收。退出时直接中止，不为它拖住退出。 */
export class MediaRecycleLifecycle {
  private started = false
  private controller: AbortController | undefined

  async runInBackground(sweep: (signal: AbortSignal) => Promise<void>, timeoutMs = 10 * 60_000): Promise<void> {
    if (this.started) return
    this.started = true
    const controller = this.controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new MediaRecycleStopped()), timeoutMs)
    try { await sweep(controller.signal) } finally { clearTimeout(timer); this.controller = undefined }
  }

  stop(): void { this.started = true; this.controller?.abort(new MediaRecycleStopped()) }
}

export const mediaRecycleLifecycle = new MediaRecycleLifecycle()
