const RATIO = 1.02
const SMALLEST_MS = 0.001
const LOG_RATIO = Math.log(RATIO)

export interface VideoEditTimingDistribution { count: number; p50: number | null; p95: number | null; max: number | null }

/**
 * 毫秒耗时的有限内存分布：小于 0.001ms 的值记作 0，其余按 2% 宽的几何桶计数（从 0.001ms 到一小时不超过约 1100 个桶），
 * 长时间播放内存也有上限。分位数按最近秩（排序后第 ⌈q·n⌉ 个样本）落到桶上，取桶的几何中点，相对误差不超过 1%；
 * 次数、总和与最大值精确。
 */
export class VideoEditTimingHistogram {
  private readonly buckets = new Map<number, number>()
  private zeros = 0
  count = 0
  total = 0
  max = 0

  add(ms: number): void {
    if (!Number.isFinite(ms)) return
    this.count++; this.total += ms; this.max = this.count === 1 ? ms : Math.max(this.max, ms)
    if (ms < SMALLEST_MS) { this.zeros++; return }
    const index = Math.floor(Math.log(ms / SMALLEST_MS) / LOG_RATIO)
    this.buckets.set(index, (this.buckets.get(index) ?? 0) + 1)
  }

  quantile(q: number): number | null {
    if (!this.count) return null
    const rank = Math.max(1, Math.ceil(q * this.count))
    if (rank <= this.zeros) return 0
    let seen = this.zeros
    for (const index of [...this.buckets.keys()].sort((a, b) => a - b)) {
      seen += this.buckets.get(index)!
      if (seen >= rank) return Math.min(this.max, SMALLEST_MS * RATIO ** (index + 0.5))
    }
    return this.max
  }

  distribution(): VideoEditTimingDistribution {
    const round = (value: number | null): number | null => value === null ? null : Math.round(value * 100) / 100
    return { count: this.count, p50: round(this.quantile(0.5)), p95: round(this.quantile(0.95)), max: this.count ? round(this.max) : null }
  }
}
