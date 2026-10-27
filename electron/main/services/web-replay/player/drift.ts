/**
 * 重演画面与录制时间是否对得上。页面按真实时钟往前走，机器忙、取帧跟不上时，第 i 帧拿到的是更晚时刻的
 * 页面，内容就比录制时间超前；位置轨、文字轨的采样同理。这里按超前了多少（录制时间毫秒）判断，不只数帧。
 */

/** 任一帧比它应在的录制时刻超前超过这么多，就认定这次结果和录制错位。 */
export const DRIFT_PEAK_LIMIT_MS = 500
/** 整段平均超前超过这么多也算错位：持续的小幅落后让整段都对不上。 */
export const DRIFT_MEAN_LIMIT_MS = 100
/** 一次采样在页面里实际执行的时刻比该取的时刻晚超过这么多就不写：记在那一刻会错位。 */
export const SAMPLE_STALE_LIMIT_MS = 100
/** 舍弃的采样超过这个比例（且多于 2 个），轨就太稀、对不上画面了。 */
export const SAMPLE_STALE_SHARE_LIMIT = 0.1
/** 错位时把页面放慢一倍重演，最多重演这么多遍、放慢到这么多倍。 */
export const MAX_REPLAY_ATTEMPTS = 3
export const MAX_REPLAY_TIME_SCALE = 32

export interface ReplayDrift {
  /** 量过的帧数、其中超前超过半帧的帧数。 */
  frames: number
  lateFrames: number
  peakLeadMs: number
  meanLeadMs: number
  /** 拿回结果的采样数、其中太迟而舍弃的个数。 */
  samples: number
  staleSamples: number
}

export class ReplayDriftMeter {
  private frames = 0
  private late = 0
  private peak = 0
  private total = 0
  private readonly halfFrameMs: number
  constructor(fps: number) { this.halfFrameMs = 500 / fps }

  /** leadMs：这一帧取到的页面比它应在的录制时刻超前多少毫秒（录制时间）。 */
  record(leadMs: number): void {
    const lead = Math.max(0, leadMs)
    this.frames += 1
    this.total += lead
    if (lead > this.peak) this.peak = lead
    if (lead > this.halfFrameMs) this.late += 1
  }

  reset(): void { this.frames = 0; this.late = 0; this.peak = 0; this.total = 0 }

  get peakLeadMs(): number { return this.peak }

  summary(samples: { samples: number; stale: number } = { samples: 0, stale: 0 }): ReplayDrift {
    return { frames: this.frames, lateFrames: this.late, peakLeadMs: Math.round(this.peak), meanLeadMs: this.frames ? Math.round(this.total / this.frames) : 0, samples: samples.samples, staleSamples: samples.stale }
  }
}

export function replayAligned(drift: ReplayDrift): boolean {
  return drift.peakLeadMs <= DRIFT_PEAK_LIMIT_MS && drift.meanLeadMs <= DRIFT_MEAN_LIMIT_MS && !(drift.staleSamples > 2 && drift.staleSamples > drift.samples * SAMPLE_STALE_SHARE_LIMIT)
}

function seconds(ms: number): string { return (ms / 1000).toFixed(1) }

function describe(drift: ReplayDrift): string {
  if (drift.peakLeadMs > DRIFT_PEAK_LIMIT_MS || drift.meanLeadMs > DRIFT_MEAN_LIMIT_MS) return `画面最多比录制时间超前约 ${seconds(drift.peakLeadMs)} 秒`
  return `界面文字与元素位置有 ${drift.staleSamples} 个时刻取得太慢`
}

/** 这一遍重演和录制时间错位：结果已丢弃，可以放慢后再来。 */
export class WebReplayDriftError extends Error {
  constructor(readonly timeScale: number, readonly drift: ReplayDrift) {
    super(`重演跟不上录制的节奏：${describe(drift)}`)
    this.name = 'WebReplayDriftError'
  }
}

/** 放慢到上限仍然错位：不能把错位的结果当成功。 */
export class WebReplayMisalignedError extends Error {
  constructor(readonly timeScale: number, readonly drift: ReplayDrift) {
    super(`电脑太忙，重演跟不上录制的节奏：已放慢到 ${timeScale} 倍重演，${describe(drift)}，出的视频、文字轨和位置轨会和录制时间错位，所以没有保存这次结果。请等电脑空闲些（比如其他重演、导出或生成结束后）再试。`)
    this.name = 'WebReplayMisalignedError'
  }
}

/** 下一遍放慢到几倍；null 表示不再重试。attempt 从 1 起。 */
export function nextReplayTimeScale(timeScale: number, attempt: number): number | null {
  const next = timeScale * 2
  return attempt < MAX_REPLAY_ATTEMPTS && next <= MAX_REPLAY_TIME_SCALE ? next : null
}

/**
 * 重演直到和录制对得上：第一遍按 render 自己的默认速度，错位就放慢一倍再来；到上限仍错位抛出
 * WebReplayMisalignedError。其他错误原样抛出、不重试。
 */
export async function renderAligned<T>(
  render: (timeScale: number | undefined) => Promise<T>,
  hooks: { signal?: AbortSignal; onRetry?: (failure: WebReplayDriftError, nextTimeScale: number, attempt: number) => void } = {},
): Promise<{ result: T; retries: WebReplayDriftError[] }> {
  const retries: WebReplayDriftError[] = []
  let timeScale: number | undefined
  for (let attempt = 1; ; attempt += 1) {
    if (hooks.signal?.aborted) throw new Error('已取消重演')
    try {
      return { result: await render(timeScale), retries }
    } catch (error) {
      if (!(error instanceof WebReplayDriftError)) throw error
      const next = nextReplayTimeScale(error.timeScale, attempt)
      if (next === null) throw new WebReplayMisalignedError(error.timeScale, error.drift)
      retries.push(error)
      hooks.onRetry?.(error, next, attempt)
      timeScale = next
    }
  }
}
