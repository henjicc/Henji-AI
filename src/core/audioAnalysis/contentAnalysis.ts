import { BeatAnalyzer } from './beatAnalysis'
import { videoEditFft } from '../videoEdit/fft'

export const AUDIO_BANDS = ['bass', 'mid', 'treble'] as const
export type AudioBand = typeof AUDIO_BANDS[number]
/** Times are seconds from the beginning of the analyzed interval. No PCM is retained. */
export interface AudioContentAnalysis {
  fps: number; duration: number; levels: number[]; bands: Record<AudioBand, number[]>
  beats: number[]; onsets: number[]; bpm: number; beatsPerBar: number; barOrigin: number
}
export class AudioContentAnalyzer {
  private readonly beats: BeatAnalyzer
  private readonly levels: number[] = []
  private readonly bands: Record<AudioBand, number[]> = { bass: [], mid: [], treble: [] }
  private planes: number[][] = []
  private samples = 0
  private frame = 0
  constructor(private readonly sampleRate: number, private readonly fps: number) {
    if (!Number.isFinite(fps) || fps <= 0 || fps > sampleRate) throw new Error('音频分析帧率无效。')
    this.beats = new BeatAnalyzer(sampleRate)
  }
  append(planes: readonly Float32Array[]): void {
    this.beats.append(planes)
    if (!this.planes.length) this.planes = planes.map(() => [])
    if (planes.length !== this.planes.length) throw new Error('音频分析过程中声道数量发生变化。')
    for (let i = 0; i < planes[0].length; i++) {
      planes.forEach((plane, channel) => this.planes[channel].push(plane[i]))
      this.samples++
      if (this.samples >= Math.ceil((this.frame + 1) * this.sampleRate / this.fps - 1e-7)) this.flush()
    }
  }
  private flush(): void {
    const count = this.planes[0]?.length ?? 0
    if (!count) return
    const size = 2 ** Math.ceil(Math.log2(Math.max(2, count)))
    const energy = { bass: 0, mid: 0, treble: 0 }; let sum = 0
    for (const plane of this.planes) {
      const real = new Float64Array(size), imaginary = new Float64Array(size)
      plane.forEach((value, i) => { sum += value * value; real[i] = value })
      videoEditFft(real, imaginary, -1)
      // Parseval energy, no rectification/mixing of opposite-phase channels.
      for (let bin = 0; bin <= size / 2; bin++) {
        const hz = bin * this.sampleRate / size
        const band: AudioBand = hz < 250 ? 'bass' : hz < 4000 ? 'mid' : 'treble'
        energy[band] += (real[bin] ** 2 + imaginary[bin] ** 2) * (bin === 0 || bin === size / 2 ? 1 : 2) / size
      }
    }
    const denominator = count * this.planes.length
    this.levels.push(Math.min(1, Math.sqrt(sum / denominator)))
    for (const band of AUDIO_BANDS) this.bands[band].push(Math.min(1, Math.sqrt(energy[band] / denominator)))
    this.planes.forEach(plane => { plane.length = 0 }); this.frame++
  }
  finish(): AudioContentAnalysis {
    this.flush()
    const result = this.beats.finish()
    const strongest = result.beats.reduce((best, beat) => !best || beat.strength > best.strength ? beat : best, result.beats[0])
    return { fps: this.fps, duration: this.samples / this.sampleRate, levels: this.levels, bands: this.bands, beats: result.beats.map(beat => beat.seconds), onsets: result.onsets.map(beat => beat.seconds), bpm: result.tempo ?? 0, beatsPerBar: 4, barOrigin: strongest?.seconds ?? 0 }
  }
}

export function sampleAudioContent(data: AudioContentAnalysis | undefined, operation: string, seconds: number, band?: string): number | readonly number[] {
  if (operation === 'beats' || operation === 'onsets') return data?.[operation] ?? []
  if (!data) return 0
  if (operation === 'bpm') return data.bpm
  if (!Number.isFinite(seconds)) throw new Error('音频采样时间必须是有限秒数。')
  if (seconds < 0 || seconds >= data.duration) return 0
  if (operation === 'level' || operation === 'band') {
    const frame = Math.floor(seconds * data.fps + 1e-7)
    return operation === 'level' ? data.levels[frame] ?? 0 : data.bands[band as AudioBand]?.[frame] ?? 0
  }
  if (!data.bpm || !data.beats.length) return 0
  if (operation === 'barPhase') return ((seconds - data.barOrigin) * data.bpm / 60 / data.beatsPerBar % 1 + 1) % 1
  let left = 0, right = data.beats.length
  while (left < right) { const mid = (left + right) >>> 1; if (data.beats[mid] <= seconds) left = mid + 1; else right = mid }
  if (!left || left === data.beats.length && seconds > data.beats[left - 1] + 60 / data.bpm) return 0
  const from = data.beats[left - 1], to = data.beats[left] ?? from + 60 / data.bpm
  return Math.min(1, Math.max(0, (seconds - from) / (to - from)))
}
