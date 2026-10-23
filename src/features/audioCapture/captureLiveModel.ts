import type { AudioCaptureSamples } from '@/core/audioCapture/contracts'
import type { WaveformData } from '@/services/waveform/waveformDataService'
export function isCaptureShortcut(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey' | 'repeat'>): boolean {
  return !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey && (event.key === ' ' && event.shiftKey || event.key.toLowerCase() === 'r')
}

export function captureTimecode(seconds: number): string {
  const milliseconds = Math.max(0, Math.floor(seconds * 1000))
  return `${String(Math.floor(milliseconds / 3600000)).padStart(2, '0')}:${String(Math.floor(milliseconds / 60000) % 60).padStart(2, '0')}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')}.${String(milliseconds % 1000).padStart(3, '0')}`
}
export const captureLevelRatio = (amplitude: number): number => Math.max(0, Math.min(1, (20 * Math.log10(Math.max(1e-9, amplitude)) + 60) / 60))

/** 固定十秒、每秒一百桶；仅保存峰值与平方和，长录音也不积累 PCM。 */
export class CaptureWaveform {
  private readonly peak = [new Float32Array(1000), new Float32Array(1000)]
  private readonly square = [new Float64Array(1000), new Float64Array(1000)]
  private readonly count = new Uint32Array(1000)
  private lastBucket = -1
  private channels: 1 | 2 = 1
  push(samples: AudioCaptureSamples): void {
    this.channels = samples.channels === 2 ? 2 : 1
    const pcm = new DataView(samples.pcm.buffer, samples.pcm.byteOffset, samples.pcm.byteLength)
    const frames = Math.min(samples.frames, Math.floor(samples.pcm.byteLength / (4 * samples.channels)))
    for (let frame = 0; frame < frames; frame++) {
      const bucket = Math.floor((samples.firstFrame + frame) * 100 / samples.sampleRate)
      if (bucket < this.lastBucket) continue
      while (this.lastBucket < bucket) {
        if (bucket - this.lastBucket > 1000) this.lastBucket = bucket - 1000
        const next = ++this.lastBucket % 1000
        this.count[next] = 0
        for (let channel = 0; channel < 2; channel++) { this.peak[channel][next] = 0; this.square[channel][next] = 0 }
      }
      const slot = bucket % 1000
      this.count[slot]++
      for (let channel = 0; channel < this.channels; channel++) {
        const sample = pcm.getFloat32((frame * samples.channels + channel) * 4, true)
        if (!Number.isFinite(sample)) continue
        this.peak[channel][slot] = Math.max(this.peak[channel][slot], Math.abs(sample))
        this.square[channel][slot] += sample * sample
      }
    }
  }
  snapshot(): WaveformData {
    const peak = Array.from({ length: this.channels }, () => new Uint16Array(1000))
    const rms = Array.from({ length: this.channels }, () => new Uint16Array(1000))
    for (let i = 0; i < 1000; i++) {
      const bucket = this.lastBucket - 999 + i
      if (bucket < 0) continue
      const slot = bucket % 1000
      for (let channel = 0; channel < this.channels; channel++) {
        peak[channel][i] = Math.min(65535, Math.round(this.peak[channel][slot] * 65535))
        rms[channel][i] = Math.min(65535, Math.round(Math.sqrt(this.square[channel][slot] / Math.max(1, this.count[slot])) * 65535))
      }
    }
    return { key: 'live-capture', ref: { source: '', channels: this.channels }, gain: 1, pyramid: {
      version: 'live', sampleRate: 100, frameCount: 1000, startSeconds: 0, endSeconds: 10, amplitudeScale: 1, peakMax: 1, channelCount: this.channels,
      levels: [{ samplesPerBucket: 1, bucketCount: 1000, peak, rms }],
    } }
  }
}
