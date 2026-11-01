import type { WebSourceCaptureRequest } from '../../../../src/platform/contracts/videoFrameTypes'

interface Timing { samples: number; ms?: number }
interface Reading { live: Timing; cache: Timing; requests: number; cached: boolean; lastReason?: string; probe?: { cache: boolean; remaining: number } }

/** 按页面、内容和实际取景独立学习；导出不传 adaptive，始终遵从用户的缓存开关。 */
export class WebCacheReadTiming {
  private readonly readings = new Map<string, Reading>()

  select(contentHash: string, request: WebSourceCaptureRequest): { key: string; cache: boolean; reason: string; changed: boolean; warmup: boolean; liveMs?: number; cacheMs?: number } {
    const key = JSON.stringify([request.streamId, contentHash, request.scale, request.latest, request.cacheGrid, request.boxes])
    let state = this.readings.get(key)
    if (!state) { state = { live: { samples: 0 }, cache: { samples: 0 }, requests: 0, cached: false }; this.readings.set(key, state) }
    state.requests++
    let cache: boolean, reason: string, warmup = false
    const rate = request.cacheGrid?.rate
    const frameMs = rate ? 1000 * rate.denominator / rate.numerator : 1000 / 30
    if (state.live.samples < 4) { cache = false; reason = 'sampling-live' }
    // 网页只用掉半帧预算时，把余量留给合成；此时不为试缓存反复冷开硬解器。
    else if (state.live.ms! <= frameMs / 2) { cache = false; reason = 'live-fast-enough'; state.probe = undefined; state.cached = false }
    else if (state.cache.samples < 4) { cache = true; reason = 'sampling-cache' }
    else {
      if (state.cache.ms! < state.live.ms! * (state.cached ? 1.05 : 0.95)) state.cached = true
      else if (state.cache.ms! > state.live.ms! * (state.cached ? 1.05 : 0.95)) state.cached = false
      cache = state.cached
      reason = cache ? 'cache-faster' : 'live-faster'
      // 页面脚本和设备负载会变化，周期性实测另一条路径，避免一次测量永久决定来源。
      if (!state.probe && state.requests % 120 === 0) state.probe = { cache: !cache, remaining: 5 }
      if (state.probe) {
        cache = state.probe.cache; reason = cache ? 'recheck-cache' : 'recheck-live'
        // 两次探测之间解码器可能已空闲释放；连续取一小组，首幅仅负责预热。
        warmup = state.probe.remaining === 5
        if (--state.probe.remaining === 0) state.probe = undefined
      }
    }
    const changed = state.lastReason !== reason
    state.lastReason = reason
    return { key, cache, reason, changed, warmup, liveMs: state.live.ms, cacheMs: state.cache.ms }
  }

  record(key: string, cached: boolean, ms: number, warmup = false): void {
    const state = this.readings.get(key)
    if (!state || warmup) return
    const timing = cached ? state.cache : state.live
    timing.samples++
    // 首幅包含页面/硬解器冷启动，不用它估计稳定播放与拖动的成本。
    if (timing.samples === 1) return
    timing.ms = timing.ms === undefined ? ms : timing.ms * 0.75 + ms * 0.25
  }

  close(streamId: string): void {
    for (const key of this.readings.keys()) if ((JSON.parse(key) as unknown[])[0] === streamId) this.readings.delete(key)
  }
}
