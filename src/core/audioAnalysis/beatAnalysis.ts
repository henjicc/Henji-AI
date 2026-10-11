import { videoEditFft } from '../videoEdit/fft'

export interface AudioBeat { seconds: number; strength: number }
export interface BeatAnalysisResult { beats: AudioBeat[]; onsets: AudioBeat[]; tempo: number | null }

/** Streaming spectral flux. Only a window and compact onset envelopes survive each PCM block. */
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
    // Flush a half-window so attacks near the end are not lost. Padding is not part of the result duration.
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
    return trackBeats(raw)
  }
}

/** Estimate a regular pulse from neighbouring attack intervals, then anchor it to measured attacks. */
function trackBeats(onsets: AudioBeat[]): BeatAnalysisResult {
  if (onsets.length < 3) return { beats: [], onsets, tempo: null }
  const votes = new Map<number, { weight: number; period: number }>()
  for (let i = 0; i < onsets.length; i++) for (let j = i + 1; j < Math.min(onsets.length, i + 9); j++) {
    let period = onsets[j].seconds - onsets[i].seconds
    while (period > 1.5) period /= 2
    while (period < .25) period *= 2
    const key = Math.round(60 / period), weight = Math.sqrt(onsets[i].strength * onsets[j].strength) / (j - i)
    const vote = votes.get(key) ?? { weight: 0, period: 0 }
    vote.weight += weight; vote.period += period * weight; votes.set(key, vote)
  }
  const best = [...votes.values()].sort((a, b) => b.weight - a.weight)[0]
  const period = best.period / best.weight
  // Phase comes from the loudest observed attack, not an arbitrary time-zero grid.
  const anchor = onsets.reduce((a, b) => b.strength > a.strength ? b : a)
  const first = anchor.seconds - Math.ceil((anchor.seconds - onsets[0].seconds) / period) * period
  const beats: AudioBeat[] = []; const indices: number[] = []; let cursor = 0, tick = 0
  for (let time = first; time <= onsets.at(-1)!.seconds + period * .2; time += period) {
    while (cursor + 1 < onsets.length && Math.abs(onsets[cursor + 1].seconds - time) < Math.abs(onsets[cursor].seconds - time)) cursor++
    const onset = onsets[cursor]
    if (Math.abs(onset.seconds - time) <= period * .2 && beats.at(-1)?.seconds !== onset.seconds) { beats.push({ ...onset }); indices.push(tick) }
    tick++
  }
  // Unmetered attacks remain onsets; do not invent beats through silence.
  if (beats.length < 3) return { beats: [], onsets, tempo: null }
  const meanIndex = indices.reduce((sum, value) => sum + value, 0) / indices.length, meanTime = beats.reduce((sum, value) => sum + value.seconds, 0) / beats.length
  let covariance = 0, variance = 0
  beats.forEach((beat, i) => { covariance += (indices[i] - meanIndex) * (beat.seconds - meanTime); variance += (indices[i] - meanIndex) ** 2 })
  return { beats, onsets, tempo: 60 / (covariance / variance) }
}
