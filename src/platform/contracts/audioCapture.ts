import type { AudioCaptureEvent, AudioCaptureInventory, AudioCaptureSettings, AudioCaptureSettingsState, AudioCaptureStart, AudioCaptureStatus, AudioCaptureLevel, AudioCaptureSamples } from '../../core/audioCapture/contracts'
export const AUDIO_CAPTURE_CHANNEL = 'audioCapture:request'
export const AUDIO_CAPTURE_EVENT_CHANNEL = 'audioCapture:event'
/**
 * 系统声（回环）由原生录音服务采集并按段落盘，只在 Windows 上；macOS 仍由界面经屏幕共享采集。
 * 主进程与预加载都按这一条判断。
 */
export const nativeSystemAudioSupported = (platform: string): boolean => platform === 'win32'
export interface AudioCapturePlatform {
  prepareFile(placement?: import('../../core/audioCapture/contracts').AudioCapturePlacement): Promise<import('../../core/audioCapture/contracts').AudioCaptureFile>
  pendingFiles(): Promise<import('../../core/audioCapture/contracts').AudioCaptureFile[]>
  /** 本窗口仍在进行的音频编辑录音（界面重载或崩溃后接管用）；没有时为 null。 */
  active(): Promise<(AudioCaptureStatus & { settings: AudioCaptureSettings }) | null>
  completeFile(outputPath: string): Promise<void>
  trashFile(outputPath: string): Promise<void>
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
  /** 系统声由原生录音服务采集（Windows）；为 false 时界面经屏幕共享采集。 */
  readonly nativeSystemAudio: boolean
  /** 原生系统声写进 directory；轨道时间相对 originUs（主进程单调微秒）。 */
  startSystemAudio(directory: string, originUs: number): Promise<{ sessionId: string }>
  /** 停止后交回这段的轨道记录（开段、封段、空档），最后一段已经封口。 */
  stopSystemAudio(sessionId: string): Promise<{ records: import('../../core/screenRecording/trackJournal').RecordingTrackRecord[] }>
  onEvent(handler: (event: AudioCaptureEvent) => void): () => void
  onLevel(handler: (level: AudioCaptureLevel) => void): () => void
  onSamples(handler: (samples: AudioCaptureSamples) => void): () => void
  onDevicesChanged(handler: (inventory: AudioCaptureInventory) => void): () => void
}
