/**
 * 网页重演渲染的全局排队：同一时间只跑一个，后来的按到达顺序等前一个结束再开始。
 * 重演页面按真实时钟往前走，几段同时渲染会互相抢 CPU 与编码器，取帧跟不上时画面就比录制时间超前。
 * 排队中取消会直接离开队列、不再开始，前后的任务照常进行。
 */
export class ReplayRenderQueue {
  private running = false
  private readonly waiting: Array<() => void> = []

  /** 正在跑的加上排队中的个数。 */
  get size(): number { return (this.running ? 1 : 0) + this.waiting.length }

  async run<T>(work: () => Promise<T>, options: { signal?: AbortSignal; onQueued?: (ahead: number) => void; onCancelled?: () => void } = {}): Promise<T> {
    if (options.signal?.aborted) throw cancelled()
    if (this.running) await this.wait(options)
    else this.running = true
    try { return await work() } finally { this.release() }
  }

  private wait({ signal, onQueued, onCancelled }: { signal?: AbortSignal; onQueued?: (ahead: number) => void; onCancelled?: () => void }): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const start = (): void => { signal?.removeEventListener('abort', leave); resolve() }
      const leave = (): void => {
        const index = this.waiting.indexOf(start)
        if (index < 0) return
        this.waiting.splice(index, 1)
        onCancelled?.()
        reject(cancelled())
      }
      signal?.addEventListener('abort', leave, { once: true })
      this.waiting.push(start)
      // 前面还有：正在跑的一个，加上比它先排队的。
      onQueued?.(this.waiting.length)
    })
  }

  /** 直接把位子交给下一个，中间不让新来的插队。 */
  private release(): void {
    const next = this.waiting.shift()
    if (next) next()
    else this.running = false
  }
}

function cancelled(): Error {
  const error = new Error('已取消重演')
  error.name = 'AbortError'
  return error
}
