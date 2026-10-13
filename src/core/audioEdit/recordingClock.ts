/** Correlation uncertainty is an estimate, not measured physical microphone latency. */
export const RECORDING_CLOCK_RECALIBRATION_SECONDS = 5
/** 100ppm 上界用于校准间隔的不确定度，5s 内为 0.5ms。 */
export function recordingClockDriftUncertainty(elapsedSeconds: number): number {
  return Math.ceil(Math.max(0, elapsedSeconds) * 100)
}

export function correlateRecordingClock(input: { originMs: number; beforeMs: number; afterMs: number; currentSeconds: number; timestamp?: { contextTime?: number; performanceTime?: number }; sampleRate: number; baseLatency: number; inputLatency?: number; outputLatency?: number }): { offsetUs: number; uncertaintyUs: number; trusted: boolean } {
  const trusted = (input.timestamp?.performanceTime ?? 0) > 0 && input.timestamp?.contextTime !== undefined
  const clock = trusted ? input.timestamp!.contextTime! : input.currentSeconds
  const wall = trusted ? input.timestamp!.performanceTime! : (input.beforeMs + input.afterMs) / 2
  const inputLatency = input.inputLatency !== undefined && Number.isFinite(input.inputLatency) && input.inputLatency >= 0 ? input.inputLatency : undefined
  const outputLatency = input.outputLatency !== undefined && Number.isFinite(input.outputLatency) && input.outputLatency >= 0 ? input.outputLatency : undefined
  return {
    offsetUs: Math.round((wall - input.originMs - clock * 1000 - ((trusted ? outputLatency ?? 0 : 0) + (inputLatency ?? 0)) * 1000) * 1000),
    // 延迟是设备估计值，不是物理测量；未知输出按高延迟设备保守处理。
    uncertaintyUs: Math.ceil(Math.max(0, input.afterMs - input.beforeMs) * 500 + (input.baseLatency + 128 / input.sampleRate + (inputLatency ?? .1) + (outputLatency ?? .3)) * 1_000_000),
    trusted: trusted && inputLatency !== undefined && outputLatency !== undefined,
  }
}
export function recordingUncertaintyP95(values: readonly number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.ceil(sorted.length * .95) - 1]
}
