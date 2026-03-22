const MIN_SETTLE_DELAY_MS = 450
const MAX_SETTLE_DELAY_MS = 900
const GAP_TO_DELAY_FACTOR = 30

export function resolveProgressSettleDelayMs(fromProgress: number): number {
  const clamped = Math.min(100, Math.max(0, fromProgress))
  const gap = Math.max(0, 100 - clamped)
  const delay = Math.round(gap * GAP_TO_DELAY_FACTOR)

  return Math.max(MIN_SETTLE_DELAY_MS, Math.min(MAX_SETTLE_DELAY_MS, delay))
}
