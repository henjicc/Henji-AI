import type { AudioCaptureEvent, AudioCaptureInventory, AudioCaptureSettings, AudioCaptureSettingsState, AudioCaptureStart, AudioCaptureStatus, AudioCaptureLevel, AudioCaptureSamples } from '../../core/audioCapture/contracts'
export const AUDIO_CAPTURE_CHANNEL = 'audioCapture:request'
export const AUDIO_CAPTURE_EVENT_CHANNEL = 'audioCapture:event'
export interface AudioCapturePlatform {
  enumerate(): Promise<AudioCaptureInventory>
  probe(settings: AudioCaptureSettings): Promise<{ formats: { sampleRate: number; bitDepth: number; supported: boolean }[] }>
  getSettings(): Promise<AudioCaptureSettingsState>
  setSettings(settings: AudioCaptureSettings, expectedRevision: number): Promise<AudioCaptureSettingsState>
  start(request: AudioCaptureStart): Promise<AudioCaptureStatus & { notice: string | null }>
  pause(sessionId: string): Promise<AudioCaptureStatus>
  resume(sessionId: string): Promise<AudioCaptureStatus>
  stop(sessionId: string): Promise<AudioCaptureStatus>
  status(sessionId: string): Promise<AudioCaptureStatus>
  /** 往返调用前后取 performance.now()，复用 captureClockCorrelation。 */
  clock(): Promise<{ mainUs: number; uncertaintyUs: number }>
  recover(outputPath: string): Promise<{ writtenBytes: number }>
  openAsioPanel(settings: AudioCaptureSettings): Promise<void>
  onEvent(handler: (event: AudioCaptureEvent) => void): () => void
  onLevel(handler: (level: AudioCaptureLevel) => void): () => void
  onSamples(handler: (samples: AudioCaptureSamples) => void): () => void
  onDevicesChanged(handler: (inventory: AudioCaptureInventory) => void): () => void
}
