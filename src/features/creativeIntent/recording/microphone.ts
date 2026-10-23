import { getPlatform } from '@/platform'
import { createLogger } from '@/core/logging'
import { captureClockCorrelation, RECORDING_CLOCK_RECALIBRATION_SECONDS } from '@/core/captureLog/clockSync'
import { recordingClockDriftUncertainty } from '@/core/audioEdit/recordingClock'
import type { AudioCaptureSamples, AudioCaptureStatus } from '@/core/audioCapture/contracts'

export interface CapturedAudioBlock { firstFrame: number; samples: Float32Array; sampleRate: number; monoStartUs: number; uncertaintyUs: number; channels?: number; bitDepth?: 16 | 24 | 32; latencyCompensationUs?: number }
export interface MicrophoneCapture { stop(): Promise<void> }
export interface AudioCaptureOptions { originMs?: () => number; onDeviceState?: (state: 'ended' | 'muted' | 'unmuted') => void }
const logger = createLogger('features.creativeIntent.microphone')

/** 讲解转写仍用单声道，取设置里的起始输入；保持帧号和时钟，不平均左右声道。 */
export function monoCapturedAudioBlock(block: CapturedAudioBlock): CapturedAudioBlock {
  const channels = block.channels ?? 1
  return channels === 1 ? block : { ...block, channels: 1, samples: Float32Array.from({ length: block.samples.length / channels }, (_, frame) => block.samples[frame * channels]) }
}

/** 原生采样时间映射到调用方起点；不按投递时刻重打时间戳，也不压掉暂停空隙。 */
export function nativeMicrophoneBlock(event: AudioCaptureSamples, correlation: { originMs: number; uncertaintyUs: number }, originMs: number, bitDepth: 16 | 24 | 32): CapturedAudioBlock {
  if (event.pcm.byteLength !== event.frames * event.channels * 4) throw new Error('原生麦克风采样长度不完整')
  return { firstFrame: event.firstFrame, samples: new Float32Array(event.pcm.slice().buffer), sampleRate: event.sampleRate, channels: event.channels, bitDepth,
    // 原生漂移估计可能包含小数；清单使用整数微秒，向上取整保留误差上界。
    monoStartUs: Math.max(0, Math.round(event.monoUs + (correlation.originMs - originMs) * 1000)), uncertaintyUs: Math.ceil(event.uncertaintyUs + correlation.uncertaintyUs), latencyCompensationUs: 0 }
}

/** 所有麦克风消费者使用同一原生设备设置；主进程共享设备，每个订阅独立释放和背压。 */
export async function captureMicrophone(originMs: number, onBlock: (block: CapturedAudioBlock) => void, onInterrupt: (message: string) => void, signal: AbortSignal, options: AudioCaptureOptions = {}): Promise<MicrophoneCapture> {
  const platform = getPlatform(), api = platform.audioCapture
  let status: AudioCaptureStatus | undefined, interrupted = false, stopping: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let releaseSamples = (): void => {}, releaseEvents = (): void => {}
  let correlation = { originMs: 0, uncertaintyUs: 0 }, calibratedAt = 0
  const early: AudioCaptureSamples[] = []
  const calibrate = async (): Promise<void> => {
    const beforeMs = performance.now(), sample = await api.clock(), afterMs = performance.now()
    const next = captureClockCorrelation({ beforeMs, afterMs, mainUs: sample.mainUs }, 0)
    correlation = { ...next, uncertaintyUs: next.uncertaintyUs + sample.uncertaintyUs }; calibratedAt = afterMs
  }
  const receive = (event: AudioCaptureSamples): void => {
    if (!status) { if (early.length >= 128) throw new Error('原生麦克风启动采样积压'); early.push(event); return }
    if (event.sessionId !== status.sessionId || signal.aborted || interrupted) return
    const block = nativeMicrophoneBlock(event, correlation, options.originMs?.() ?? originMs, status.settings?.bitDepth ?? 24)
    block.uncertaintyUs += recordingClockDriftUncertainty(Math.abs(performance.now() - calibratedAt) / 1000)
    onBlock(block)
  }
  const schedule = (): void => {
    timer = setTimeout(() => { void calibrate().then(() => { if (!stopping && !interrupted) schedule() }).catch(error => { onInterrupt('麦克风时钟校准失败，请停止后重试。'); logger.warn('麦克风时钟校准失败', { event: 'microphone.clock.failed', error }) }) }, RECORDING_CLOCK_RECALIBRATION_SECONDS * 1000)
  }
  const stop = (): Promise<void> => {
    if (stopping) return stopping
    clearTimeout(timer)
    stopping = (async () => {
      try {
        if (status && !interrupted) {
          const result = await api.stop(status.sessionId)
          if (result.sharedSubscribers === 0) await platform.system.fs.remove(result.outputPath)
          logger.info('原生麦克风订阅结束', { event: 'microphone.capture.completed', context: { sharedSubscribers: result.sharedSubscribers } })
        }
      } finally { releaseSamples(); releaseEvents(); signal.removeEventListener('abort', abort) }
    })()
    return stopping
  }
  const abort = (): void => { void stop().catch(error => logger.warn('取消麦克风清理失败', { event: 'microphone.cancel.failed', error })) }
  try {
    signal.throwIfAborted()
    const settings = (await api.getSettings()).effectiveSettings
    await calibrate(); signal.throwIfAborted()
    releaseSamples = api.onSamples(receive)
    releaseEvents = api.onEvent(event => {
      if (event.event === 'interrupted' && event.sessionId === status?.sessionId) { interrupted = true; clearTimeout(timer); options.onDeviceState?.('ended'); onInterrupt(event.error.message) }
    })
    const outputPath = await platform.system.paths.join(await platform.system.paths.tempDir(), `henji-microphone-${crypto.randomUUID()}.wav`)
    status = await api.start({ outputPath, settings, streamSamples: true, shared: true, monitor: false })
    for (const event of early) receive(event)
    early.length = 0
    if (signal.aborted) { await stop(); signal.throwIfAborted() }
    signal.addEventListener('abort', abort, { once: true }); schedule()
    logger.info('原生麦克风订阅开始', { event: 'microphone.capture.start', context: { sampleRate: status.sampleRate, channels: status.settings?.channels, bitDepth: status.settings?.bitDepth } })
    return { stop }
  } catch (error) { await stop(); logger.warn('原生麦克风启动失败', { event: 'microphone.capture.failed', error }); throw error }
}

/** 麦克风设备只从统一原生设置选择，这里仅枚举摄像头。 */
export async function recordingDevices(): Promise<Array<{ id: string; label: string; kind: 'camera' }>> {
  return (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput').map(device => ({ id: device.deviceId, label: device.label, kind: 'camera' }))
}
