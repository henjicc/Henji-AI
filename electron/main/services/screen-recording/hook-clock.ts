/**
 * 钩子事件自带的时刻换算到主进程单调时钟。Windows 上它是系统滴答毫秒（32 位，约 49.7 天回绕），与主进程时钟（QPC）不同源。
 * 平时用收到的时刻（微秒精度）；主进程卡住、事件晚到时改用事件自己的时刻，免得卡多久就晚记多久。
 *
 * 两个时钟的差取最近一段时间里见过的最小值：那是投递最快的几次，最接近真实偏移。只取最近一段而不是全程最小值，
 * 是因为两个时钟有几 ppm 到几十 ppm 的漂移：全程最小值只降不升，两小时下来能偏出几十毫秒，事件就整体记早了。
 *
 * macOS 上 uiohook 给的是 mach_absolute_time 的原始计数，不是毫秒，不做换算（enabled=false 时总用收到的时刻）。
 */
export class HookEventClock {
  /** 晚到超过这么多才算卡顿：系统滴答粒度约 16 毫秒，门槛太低会在收到时刻与按滴答取整的钩子时刻之间来回切换。 */
  static readonly LATE_US = 50_000
  /** 最小值按这么长一格滚动，取当前格与上一格的最小值，也就是最近 15–30 秒。 */
  static readonly WINDOW_US = 15_000_000
  private current = { since: Number.NEGATIVE_INFINITY, min: Number.POSITIVE_INFINITY }
  private previous = Number.POSITIVE_INFINITY
  private lastTick: number | undefined
  private wraps = 0
  constructor(private readonly enabled = process.platform === 'win32') {}

  at(receivedUs: number, hookMs: number | undefined): number {
    if (!this.enabled || hookMs === undefined || !Number.isFinite(hookMs)) return receivedUs
    // 32 位滴答回绕：比上一次小了一半以上就是绕回来了。
    if (this.lastTick !== undefined && hookMs < this.lastTick - 2 ** 31) this.wraps++
    this.lastTick = hookMs
    const tickUs = (hookMs + this.wraps * 2 ** 32) * 1000
    const candidate = receivedUs - tickUs
    let offset = Math.min(this.previous, this.current.min)
    // 卡得离谱（超过一分钟）或两个时钟跳变：旧偏移不可信，从这一条重新对齐。
    if (Number.isFinite(offset) && candidate - offset > 60_000_000) { this.previous = Number.POSITIVE_INFINITY; this.current = { since: receivedUs, min: Number.POSITIVE_INFINITY } }
    if (receivedUs - this.current.since >= HookEventClock.WINDOW_US) {
      // 隔了两格以上没有事件（例如很久没动鼠标），上一格的偏移已经是很久以前的，不再沿用。
      this.previous = receivedUs - this.current.since >= 2 * HookEventClock.WINDOW_US ? Number.POSITIVE_INFINITY : this.current.min
      this.current = { since: receivedUs, min: Number.POSITIVE_INFINITY }
    }
    this.current.min = Math.min(this.current.min, candidate)
    offset = Math.min(this.previous, this.current.min)
    const hookUs = tickUs + offset
    return receivedUs - hookUs > HookEventClock.LATE_US ? Math.round(hookUs) : receivedUs
  }
}
