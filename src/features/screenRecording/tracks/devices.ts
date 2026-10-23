import { captureStreamAudio, captureMicrophone, type CapturedAudioBlock } from '@/features/creativeIntent'
import { CaptureSourceClock } from '@/core/captureLog/clockSync'
import type { RecordingTrackKind, RecordingTrackOptions } from '@/core/screenRecording/tracks'
import type { RecordingTracksClock } from './clock'

export interface TrackDevice { stop(): Promise<void> }
export interface TrackDeviceCallbacks {
  audio(block: CapturedAudioBlock): void
  video(frame: VideoFrame, monoUs: number, uncertaintyUs: number, compensationUs: number): Promise<void>
  state(state: 'ended' | 'muted' | 'unmuted'): void
  failed(error: unknown): void
}
export type OpenTrackDevice = (kind: RecordingTrackKind, options: RecordingTrackOptions, clock: RecordingTracksClock, callbacks: TrackDeviceCallbacks, signal: AbortSignal, displayAudio?: () => Promise<MediaStream>) => Promise<TrackDevice>

export { recordingDevices } from '@/features/creativeIntent'

/** The coordinator may pass a clone of its display audio track; otherwise Chromium's single permission service picks the source. */
export async function acquireSystemAudio(): Promise<MediaStream> {
  const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
  display.getVideoTracks().forEach(track => { display.removeTrack(track); track.stop() })
  return display
}

export const openTrackDevice: OpenTrackDevice = async (kind, options, clock, callbacks, signal, displayAudio) => {
  const audio = (block: CapturedAudioBlock): void => callbacks.audio({ ...block, uncertaintyUs: block.uncertaintyUs + clock.uncertaintyUs })
  if (kind === 'microphone') return captureMicrophone(clock.originMs, audio, () => callbacks.state('ended'), signal, { originMs: () => clock.originMs, onDeviceState: callbacks.state })
  if (kind === 'systemAudio') return captureStreamAudio(clock.originMs, audio, () => callbacks.state('muted'), signal, { channels: 2, originMs: () => clock.originMs, onDeviceState: callbacks.state, acquireStream: displayAudio ?? acquireSystemAudio })
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
