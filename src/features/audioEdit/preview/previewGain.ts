/** Preview-only peak normalization, independent of waveform display scaling. */
export function calculatePreviewGain(peaks: readonly number[]): number {
  let peak = 0
  for (const value of peaks) if (Number.isFinite(value)) peak = Math.max(peak, Math.abs(value))
  // Do not amplify digital silence / the noise floor without usable signal.
  if (peak < 0.0001) return 1
  return Math.max(1, Math.min(16, 0.8 / peak))
}

export function createPreviewOutput(context: AudioContext) {
  const boost = context.createGain()
  const protection = context.createDynamicsCompressor()
  const volume = context.createGain()
  protection.threshold.value = -1
  protection.knee.value = 0
  protection.ratio.value = 20
  protection.attack.value = 0.003
  protection.release.value = 0.15
  boost.connect(protection)
  protection.connect(volume)
  volume.connect(context.destination)
  return {
    input: boost,
    setLevels(gain: number, level: number) {
      boost.gain.setTargetAtTime(gain, context.currentTime, 0.03)
      volume.gain.setTargetAtTime(level, context.currentTime, 0.03)
    },
    dispose() { boost.disconnect(); protection.disconnect(); volume.disconnect() },
  }
}
