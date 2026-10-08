export * from '../imaging/adjustments/analysis'

export function colorGradeSampleFrames(start: number, duration: number, count = 5): number[] {
  if (!Number.isInteger(count) || count < 1 || count > 9) throw new Error('采样帧数必须为1–9。')
  return [...new Set(Array.from({ length: count }, (_, i) => start + Math.min(duration - 1, Math.floor((i + .5) * duration / count))))]
}
