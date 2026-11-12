import { captureStreamAudio, captureMicrophone, type CapturedAudioBlock } from '@/features/creativeIntent'
import { CaptureSourceClock } from '@/core/captureLog/clockSync'
import type { RecordingTrackKind, RecordingTrackOptions } from '@/core/screenRecording/tracks'
import type { RecordingTrackRecord } from '@/core/screenRecording/trackJournal'
import { getPlatform } from '@/platform'
import type { RecordingTracksClock } from './clock'

export interface TrackDevice { stop(): Promise<void> }
export interface TrackDeviceCallbacks {
  audio(block: CapturedAudioBlock): void
  video(frame: VideoFrame, monoUs: number, uncertaintyUs: number, compensationUs: number): Promise<void>
  state(state: 'ended' | 'muted' | 'unmuted'): void
  failed(error: unknown): void
  /** 原生录音服务自己落盘的轨道（Windows 的系统声）：停止时交回这段的开段、封段与空档记录。 */
  records?(records: RecordingTrackRecord[]): void
}
export interface TrackDeviceContext {
  /** 这次录制的轨道目录。 */
  directory: string
  /** 兼容采集已经开着屏幕共享时，从它克隆系统声，不再开第二路。 */
  displayAudio?: () => Promise<MediaStream>
  /** 给了就是这次录屏自己的目录：原生麦克风的整段副本写在这里留给收尾，不落到系统临时目录。 */
  microphoneCopyDirectory?: string
}
export type OpenTrackDevice = (kind: RecordingTrackKind, options: RecordingTrackOptions, clock: RecordingTracksClock, callbacks: TrackDeviceCallbacks, signal: AbortSignal, context: TrackDeviceContext) => Promise<TrackDevice>

export { recordingDevices } from '@/features/creativeIntent'

/** The coordinator may pass a clone of its display audio track; otherwise Chromium's single permission service picks the source. */
export async function acquireSystemAudio(): Promise<MediaStream> {
  const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
  display.getVideoTracks().forEach(track => { display.removeTrack(track); track.stop() })
  return display
}

/** Windows：系统声由原生录音服务录进轨道目录，界面只在停止时取回轨道记录；采样不经过界面。 */
async function captureNativeSystemAudio(directory: string, originUs: number, callbacks: TrackDeviceCallbacks, signal: AbortSignal): Promise<TrackDevice> {
  signal.throwIfAborted()
  const api = getPlatform().audioCapture
  const { sessionId } = await api.startSystemAudio(directory, originUs)
  let stopping: Promise<void> | undefined
  const stop = (): Promise<void> => stopping ??= api.stopSystemAudio(sessionId).then(({ records }) => callbacks.records?.(records))
  if (signal.aborted) { await stop(); signal.throwIfAborted() }
  return { stop }
}

export const openTrackDevice: OpenTrackDevice = async (kind, options, clock, callbacks, signal, context) => {
  const audio = (block: CapturedAudioBlock): void => callbacks.audio({ ...block, uncertaintyUs: block.uncertaintyUs + clock.uncertaintyUs })
  if (kind === 'microphone') return captureMicrophone(clock.originMs, audio, () => callbacks.state('ended'), signal, { originMs: () => clock.originMs, onDeviceState: callbacks.state, ...(context.microphoneCopyDirectory ? { outputDirectory: context.microphoneCopyDirectory } : {}) })
  if (kind === 'systemAudio') {
    // 调用方自己给了声音流（macOS 兼容采集克隆的屏幕共享、巡检夹具的测试音）就用它；否则 Windows 走原生回环。
    if (!context.displayAudio && getPlatform().audioCapture.nativeSystemAudio) return captureNativeSystemAudio(context.directory, clock.originUs, callbacks, signal)
    return captureStreamAudio(clock.originMs, audio, () => callbacks.state('muted'), signal, { channels: 2, originMs: () => clock.originMs, onDeviceState: callbacks.state, acquireStream: context.displayAudio ?? acquireSystemAudio })
  }
  const camera = options.camera!
  let stream: MediaStream | undefined
  let reader: ReadableStreamDefaultReader<VideoFrame> | undefined
  let stopping: Promise<void> | undefined
  let stopped = false
  let loop: Promise<void> = Promise.resolve()
  const stop = (): Promise<void> => {
    if (stopping) return stopping
    stopped = true
    stream?.getTracks().forEach(track => track.stop())
    stopping = (async () => { await reader?.cancel(); await loop; reader?.releaseLock(); signal.removeEventListener('abort', abort) })()
    return stopping
  }
  const abort = (): void => { void stop().catch(callbacks.failed) }
  try {
    signal.throwIfAborted()
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
      ...(camera.deviceId ? { deviceId: { exact: camera.deviceId } } : {}), width: { ideal: camera.width }, height: { ideal: camera.height }, frameRate: { ideal: camera.frameRate },
    } })
    signal.throwIfAborted()
    const track = stream.getVideoTracks()[0]
    if (!track) throw new Error('摄像头没有提供画面')
    const Processor = (globalThis as unknown as { MediaStreamTrackProcessor?: new (input: { track: MediaStreamTrack; maxBufferSize: number }) => { readable: ReadableStream<VideoFrame> } }).MediaStreamTrackProcessor
    if (!Processor) throw new Error('当前环境无法采集摄像头帧')
    reader = new Processor({ track, maxBufferSize: 2 }).readable.getReader()
    const mapping = new CaptureSourceClock(Math.ceil(1_000_000 / camera.frameRate))
    for (const state of ['ended', 'mute', 'unmute'] as const) track.addEventListener(state, () => { if (!stopped) callbacks.state(state === 'mute' ? 'muted' : state === 'unmute' ? 'unmuted' : 'ended') })
    signal.addEventListener('abort', abort, { once: true })
    loop = (async () => {
      while (!stopped) {
        const { value: frame, done } = await reader!.read()
        if (done) { if (!stopped) callbacks.state('ended'); return }
        try {
          if (stopped || track.muted) continue
          const at = mapping.map(frame.timestamp, clock.nowUs())
          await callbacks.video(frame, at.monoUs, at.uncertaintyUs + clock.uncertaintyUs, at.offsetUs)
        } finally { frame.close() }
      }
    })().catch(error => { if (!stopped) callbacks.failed(error) })
    if (signal.aborted) await stop()
    return { stop }
  } catch (error) { await stop(); throw error }
}
