import type { AudioCaptureSamples } from '@/core/audioCapture/contracts'
import { videoEditFft } from '@/core/videoEdit/fft'

export interface CapturePreviewColumn { start: number; end: number; peaks: number[]; spectrum: Float32Array[] }
/** 仅保留降采样峰值和频谱，最多 8192 列；长录音成对合并，绝不积累原始 PCM。 */
export class CapturePreview {
  columns: CapturePreviewColumn[] = []
  sampleRate = 48000
  private stride = 1
  private packets = 0
  reset(): void { this.columns = []; this.stride = 1; this.packets = 0 }
  push(event: AudioCaptureSamples): void {
    const frames = Math.min(event.frames, event.pcm.byteLength / (event.channels * 4))
    if (!frames) return
    this.sampleRate = event.sampleRate
    const data = new DataView(event.pcm.buffer, event.pcm.byteOffset, event.pcm.byteLength)
    const peaks: number[] = [], spectrum: Float32Array[] = []
    for (let channel = 0; channel < event.channels; channel++) {
      let peak = 0
      const real = new Float64Array(1024), imaginary = new Float64Array(1024)
      for (let frame = 0; frame < frames; frame++) {
        const raw = data.getFloat32((frame * event.channels + channel) * 4, true)
        const value = Number.isFinite(raw) ? raw : 0
        peak = Math.max(peak, Math.abs(value))
        if (frame < real.length) real[frame] = value * (0.5 - 0.5 * Math.cos(2 * Math.PI * frame / 1023))
      }
      peaks.push(peak)
      videoEditFft(real, imaginary, -1)
      const bins = new Float32Array(128)
      for (let bin = 0; bin < 512; bin++) bins[Math.floor(bin / 4)] = Math.max(bins[Math.floor(bin / 4)], Math.hypot(real[bin], imaginary[bin]) / 256)
      spectrum.push(bins)
    }
    const column = { start: event.firstFrame / event.sampleRate, end: (event.firstFrame + frames) / event.sampleRate, peaks, spectrum }
    if (this.packets++ % this.stride && this.columns.length) this.columns[this.columns.length - 1] = merge(this.columns[this.columns.length - 1], column)
    else this.columns.push(column)
    if (this.columns.length >= 8192) {
      this.columns = this.columns.filter((_, i) => i % 2 === 0).map((value, i) => merge(value, this.columns[i * 2 + 1]))
      this.stride *= 2
    }
  }
}
function merge(a: CapturePreviewColumn, b: CapturePreviewColumn): CapturePreviewColumn {
  return { start: a.start, end: b.end, peaks: a.peaks.map((peak, i) => Math.max(peak, b.peaks[i] ?? 0)), spectrum: a.spectrum.map((bins, channel) => bins.map((value, i) => Math.max(value, b.spectrum[channel]?.[i] ?? 0))) }
}
