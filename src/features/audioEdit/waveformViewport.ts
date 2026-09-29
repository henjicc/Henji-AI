export interface WaveformViewport { start: number; end: number }

export function clampViewport(start: number, length: number, duration: number): WaveformViewport {
  const size = Math.min(duration, Math.max(1, length))
  const left = Math.max(0, Math.min(duration - size, start))
  return { start: left, end: left + size }
}

export function zoomViewport(view: WaveformViewport, anchor: number, factor: number, duration: number, minimum: number): WaveformViewport {
  const ratio = Math.max(0, Math.min(1, anchor))
  const length = view.end - view.start
  const next = Math.min(duration, Math.max(minimum, length * factor))
  return clampViewport(view.start + ratio * (length - next), next, duration)
}

export function waveformReference(peaks: readonly number[]): number {
  // One display-only scale for the entire source; never flatten strong peaks.
  let maximum = 0
  for (const peak of peaks) if (Number.isFinite(peak)) maximum = Math.max(maximum, peak)
  return maximum || 1
}

/** Aggregate only visible samples; the number of drawn bars is bounded by pixels. */
export function sampleWaveform(peaks: readonly number[], view: WaveformViewport, duration: number, count: number, reference: number): number[] {
  if (!peaks.length || duration <= 0) return []
  const bars = Math.max(1, Math.floor(count))
  return Array.from({ length: bars }, (_, index) => {
    const start = Math.max(0, Math.floor((view.start + index / bars * (view.end - view.start)) / duration * peaks.length))
    const end = Math.min(peaks.length, Math.max(start + 1, Math.ceil((view.start + (index + 1) / bars * (view.end - view.start)) / duration * peaks.length)))
    let peak = 0
    for (let offset = start; offset < end; offset += 1) peak = Math.max(peak, peaks[offset])
    return Math.min(1, peak / reference)
  })
}
