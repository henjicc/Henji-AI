import { videoEditFft } from '../videoEdit/fft'

export interface AudioBeat { seconds: number; strength: number }
export interface BeatAnalysisResult { beats: AudioBeat[]; onsets: AudioBeat[]; tempo: number | null }

/**
 * Streaming spectral flux. Only a window and compact onset envelopes survive each PCM block.
 * Performance baseline (2026-10-15, Ryzen 9 5900X, Windows, Node 24.18.0 Worker):
 * 600 s / 48 kHz mono, 65,536-sample blocks: append 4.530 s + finish 0.125 s = 4.655 s.
 * AudioContentAnalyzer at 30 fps, including this tracker and its band FFTs: 6.238 s.
 * Input: contentAnalysisMusic fixture (128 BPM, seed 11, swing .58), first 30 s repeated
 * 20 times. Timings exclude synthesis, module initialization and decoding; no PCM retained.
 */
export class BeatAnalyzer {
  private readonly size: number
  private readonly hop: number
  private readonly ring: Float64Array
  private readonly real: Float64Array
  private readonly imaginary: Float64Array
  private readonly previous: Float64Array
  private readonly window: Float64Array
  private readonly flux: number[] = []
  private readonly energy: number[] = []
  private samples = 0
  private previousEnergy = 0
  constructor(private readonly sampleRate: number) {
    if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) throw new Error('声音采样率无效。')
    this.size = Math.max(32, 2 ** Math.round(Math.log2(sampleRate * .023)))
    // The shared radix-2 FFT uses signed 32-bit indices; this is its actual addressing constraint.
    if (this.size >= 2 ** 30) throw new Error('声音采样率超出分析缓冲范围。')
    this.hop = Math.max(1, Math.round(sampleRate * .005))
    this.ring = new Float64Array(this.size); this.real = new Float64Array(this.size); this.imaginary = new Float64Array(this.size)
    this.previous = new Float64Array(this.size / 2 + 1)
    this.window = Float64Array.from({ length: this.size }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / (this.size - 1)))
  }
  append(planes: readonly Float32Array[]): void {
    if (!planes.length || planes.some(p => p.length !== planes[0].length)) throw new Error('声音声道数据不完整。')
    for (let i = 0; i < planes[0].length; i++) {
      // RMS across channels prevents opposite-phase stereo from erasing transients.
      let energy = 0
      for (const plane of planes) { const value = plane[i]; if (!Number.isFinite(value)) throw new Error('声音包含无效采样。'); energy += value * value }
      this.ring[this.samples % this.size] = Math.sqrt(energy / planes.length)
      this.samples++
      if (this.samples % this.hop === 0) this.analyzeWindow()
    }
  }
  private analyzeWindow(): void {
    let energy = 0
    for (let i = 0; i < this.size; i++) {
      const value = this.samples < this.size && i < this.size - this.samples ? 0 : this.ring[(this.samples + i) % this.size]
      this.real[i] = value * this.window[i]; energy += this.real[i] ** 2; this.imaginary[i] = 0
    }
    videoEditFft(this.real, this.imaginary, -1)
    let flux = 0
    for (let i = 1; i < this.previous.length; i++) {
      const magnitude = Math.hypot(this.real[i], this.imaginary[i])
      flux += Math.max(0, magnitude - this.previous[i]); this.previous[i] = magnitude
    }
    this.flux.push(flux)
    this.energy.push(Math.max(0, energy - this.previousEnergy)); this.previousEnergy = energy
  }
  finish(): BeatAnalysisResult {
    // Flush a window so attacks near the end are not lost. Padding is not part of the result duration.
    const duration = this.samples / this.sampleRate
    this.append([new Float32Array(this.size)])
    let peak = 0
    for (const value of this.flux) peak = Math.max(peak, value)
    if (peak < 1e-7) return { beats: [], onsets: [], tempo: null }
    const radius = Math.max(1, Math.round(.1 * this.sampleRate / this.hop))
    const prefix = [0]
    for (const value of this.flux) prefix.push(prefix.at(-1)! + value)
    const raw: AudioBeat[] = []
    for (let i = 0; i < this.flux.length; i++) {
      const value = this.flux[i], from = Math.max(0, i - radius), to = Math.min(this.flux.length, i + radius + 1)
      const mean = (prefix[to] - prefix[from]) / (to - from)
      const seconds = Math.max(0, ((i + 1) * this.hop - this.size / 2) / this.sampleRate)
      if (seconds >= duration || value < peak * .035 || value < mean * 1.5 || this.energy[i] <= 1e-10 || value < (this.flux[i - 1] ?? 0) || value <= (this.flux[i + 1] ?? 0)) continue
      const onset = { seconds, strength: value / peak }, previous = raw.at(-1)
      if (previous && seconds - previous.seconds < .07) { if (onset.strength > previous.strength) raw[raw.length - 1] = onset }
      else raw.push(onset)
    }
    return trackBeats(raw, this.flux, this.hop / this.sampleRate, this.size / 2 / this.sampleRate)
  }
}

/**
 * Ellis (2007): onset autocorrelation with a log-tempo prior, then dynamic programming.
 * This is an independent implementation of the published method, not copied librosa code.
 * https://labrosa.ee.columbia.edu/projects/beattrack/
 */
function trackBeats(onsets: AudioBeat[], flux: number[], step: number, delay: number): BeatAnalysisResult {
  if (onsets.length < 3) return { beats: [], onsets, tempo: null }
  const envelope = new Float64Array(flux.length)
  const radius = Math.round(.1 / step), prefix = new Float64Array(flux.length + 1)
  for (let i = 0; i < flux.length; i++) prefix[i + 1] = prefix[i] + flux[i]
  let norm = 0
  for (let i = 0; i < flux.length; i++) {
    const from = Math.max(0, i - radius), to = Math.min(flux.length, i + radius + 1)
    envelope[i] = Math.max(0, flux[i] - (prefix[to] - prefix[from]) / (to - from))
    norm += envelope[i] ** 2
  }
  norm = Math.sqrt(norm / envelope.length)
  if (!norm) return { beats: [], onsets, tempo: null }
  for (let i = 0; i < envelope.length; i++) envelope[i] /= norm
  // Remove the local spectral-flux floor before correlation so sustained pads do not
  // vote as rhythm. RMS normalization makes the DP transition cost gain-independent.
  const minLag = Math.max(1, Math.floor(60 / 240 / step)), maxLag = Math.ceil(60 / 40 / step)
  const correlation = new Float64Array(maxLag * 2 + 1)
  for (let lag = minLag; lag < correlation.length; lag++) {
    let sum = 0
    for (let i = lag; i < envelope.length; i++) sum += envelope[i] * envelope[i - lag]
    correlation[lag] = sum / Math.max(1, envelope.length - lag)
  }
  let period = minLag, best = 0
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = 60 / (lag * step)
    // Broad 120 BPM / .9-octave prior; two-pulse support tolerates alternating kick/snare.
    const prior = Math.exp(-.5 * (Math.log2(bpm / 120) / .9) ** 2)
    const score = (correlation[lag] + .5 * correlation[lag * 2]) * prior
    if (score > best) { best = score; period = lag }
  }
  // Prefer the fundamental pulse when every half-period has comparable evidence.
  // A tempo prior alone otherwise turns fast, evenly accented clicks into half time.
  // Require comparable support at the full and double period too: alternating drum
  // timbres with weaker eighth-note subdivisions must not trigger this correction.
  const half = Math.round(period / 2)
  if (half >= minLag) {
    let candidate = half
    for (let lag = Math.max(minLag, half - 1); lag <= half + 1; lag++) if (correlation[lag] > correlation[candidate]) candidate = lag
    // Doubling a rounded lag introduces up to two frames of quantization error.
    const double = Math.max(...correlation.subarray(period * 2 - 2, period * 2 + 3))
    if (correlation[candidate] >= correlation[period] * .85 && correlation[period] >= double * .85) period = candidate
  }
  const scores = new Float64Array(envelope.length), previous = new Int32Array(envelope.length).fill(-1)
  const minInterval = Math.max(1, Math.floor(period / 2)), maxInterval = period * 2
  const penalties = Float64Array.from({ length: maxInterval + 1 }, (_, distance) => 100 * Math.log(Math.max(1, distance) / period) ** 2)
  let end = 0
  for (let i = 0; i < envelope.length; i++) {
    let bestScore = 0
    for (let distance = minInterval; distance <= Math.min(i, maxInterval); distance++) {
      const score = scores[i - distance] - penalties[distance]
      if (score > bestScore) { bestScore = score; previous[i] = i - distance }
    }
    scores[i] = bestScore + envelope[i]
    if (scores[i] > scores[end]) end = i
  }
  const path: number[] = []
  for (let i = end; i >= 0; i = previous[i]) path.push(i)
  path.reverse()
  const beats: AudioBeat[] = [], indices: number[] = []
  let cursor = 0
  for (let tick = 0; tick < path.length; tick++) {
    const time = (path[tick] + 1) * step - delay
    while (cursor + 1 < onsets.length && Math.abs(onsets[cursor + 1].seconds - time) < Math.abs(onsets[cursor].seconds - time)) cursor++
    const onset = onsets[cursor]
    // Only emit measured attacks, never the DP's interpolated beats through silence.
    if (Math.abs(onset.seconds - time) <= Math.min(.07, period * step * .15) && beats.at(-1)?.seconds !== onset.seconds) {
      beats.push({ ...onset }); indices.push(tick)
    }
  }
  if (beats.length < 3) return { beats: [], onsets, tempo: null }
  const meanIndex = indices.reduce((sum, value) => sum + value, 0) / indices.length
  const meanTime = beats.reduce((sum, value) => sum + value.seconds, 0) / beats.length
  // Recover sub-frame tempo precision from the tracked attacks and their beat indices.
  let covariance = 0, variance = 0
  beats.forEach((beat, i) => { covariance += (indices[i] - meanIndex) * (beat.seconds - meanTime); variance += (indices[i] - meanIndex) ** 2 })
  return { beats, onsets, tempo: 60 / (covariance / variance) }
}
