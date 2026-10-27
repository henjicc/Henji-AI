export interface ReplaySamplerStats {
  requested: number
  /** 拿回结果的次数（含太迟而舍弃的）。 */
  samples: number
  skipped: number
  stale: number
  failures: number
  totalMs: number
  maxMs: number
}

/** 页面里执行的采样结果，带上它实际执行的页面时刻（毫秒，与录制时间同一条时间线）。 */
export interface TimedSample<T> { at: number; value: T }

/**
 * 包一层让采样脚本先记下页面时钟：重演页面的 performance.now() 就是录制时间（慢放时也已换算），
 * 据此判断结果是不是取得太迟，不受主进程忙、晚些才读到结果的影响。
 */
export function timedSampleScript(script: string): string { return `({ at: performance.now(), value: ${script} })` }

/**
 * 不挡帧循环的页面采样（位置轨、文字轨）：发出后不等结果，帧照常按时取。上一次还没回来，或刚采完还没
 * 歇够（每次采样后空出同样长的时间，页面自己的脚本才有机会跑），这一刻就跳过，采样慢时自然降频。
 * 页面实际执行的时刻比该取的时刻晚太多就舍弃，免得把晚些时候的界面记在早先的时间上。
 */
export class ReplaySampler<T> {
  private inFlight: Promise<void> | null = null
  private idleUntil = 0
  private closed = false
  readonly stats: ReplaySamplerStats = { requested: 0, samples: 0, skipped: 0, stale: 0, failures: 0, totalMs: 0, maxMs: 0 }

  constructor(private readonly options: {
    read: () => Promise<TimedSample<T>>
    write: (t: number, value: T) => Promise<void> | void
    /** 录制时间毫秒：页面执行时刻比该取的时刻晚超过它就舍弃。 */
    staleAfterMs: number
    onFailure: (error: unknown, failures: number) => void
  }) {}

  /** t：这一刻在输出里的时间（微秒）。 */
  request(t: number): void {
    this.stats.requested += 1
    const now = Date.now()
    if (this.closed || this.inFlight || now < this.idleUntil) { this.stats.skipped += 1; return }
    this.inFlight = this.take(t, now).finally(() => { this.inFlight = null })
  }

  private async take(t: number, started: number): Promise<void> {
    try {
      const { at, value } = await this.options.read()
      const ended = Date.now()
      const elapsed = ended - started
      this.stats.samples += 1
      this.stats.totalMs += elapsed
      if (elapsed > this.stats.maxMs) this.stats.maxMs = elapsed
      this.idleUntil = ended + elapsed
      if (this.closed) return
      if (!Number.isFinite(at) || at - t / 1000 > this.options.staleAfterMs) { this.stats.stale += 1; return }
      await this.options.write(t, value)
    } catch (error) {
      const ended = Date.now()
      this.idleUntil = ended + (ended - started)
      this.stats.failures += 1
      if (!this.closed) this.options.onFailure(error, this.stats.failures)
    }
  }

  /** 等正在跑的那次采样（含写入）结束。 */
  async drain(): Promise<void> { await this.inFlight }

  /** 之后回来的结果不再写，也不再发新的采样。 */
  close(): void { this.closed = true }
}
