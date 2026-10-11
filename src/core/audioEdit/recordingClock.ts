/** Correlation uncertainty is an estimate, not measured physical microphone latency. */
export function correlateRecordingClock(input: { originMs: number; beforeMs: number; afterMs: number; currentSeconds: number; timestamp?: { contextTime?: number; performanceTime?: number }; sampleRate: number; baseLatency: number; inputLatency?: number }): { offsetUs: number; uncertaintyUs: number; trusted: boolean } {
  const trusted = (input.timestamp?.performanceTime ?? 0) > 0 && input.timestamp?.contextTime !== undefined
  const clock = trusted ? input.timestamp!.contextTime! : input.currentSeconds
  const wall = trusted ? input.timestamp!.performanceTime! : (input.beforeMs + input.afterMs) / 2
  return { offsetUs: Math.round((wall - input.originMs - clock * 1000) * 1000), uncertaintyUs: Math.ceil(Math.max(0, input.afterMs - input.beforeMs) * 500 + (input.baseLatency + 128 / input.sampleRate + (input.inputLatency ?? .1)) * 1_000_000), trusted: trusted && input.inputLatency !== undefined }
}
export function recordingUncertaintyP95(values: readonly number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.ceil(sorted.length * .95) - 1]
}
