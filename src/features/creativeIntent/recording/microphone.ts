export interface CapturedAudioBlock { firstFrame: number; samples: Float32Array; sampleRate: number; monoStartUs: number; uncertaintyUs: number }
export interface MicrophoneCapture { stop(): Promise<void> }
/** getOutputTimestamp correlates the audio device clock; message delivery time is never the sample origin. */
export async function captureMicrophone(originMs: number, onBlock: (block: CapturedAudioBlock) => void, onInterrupt: (message: string) => void, signal: AbortSignal): Promise<MicrophoneCapture> {
  let stream: MediaStream | undefined; let context: AudioContext | undefined; let source: MediaStreamAudioSourceNode | undefined; let node: AudioWorkletNode | undefined
  let stopped = false
  const release = async (): Promise<void> => { node?.disconnect(); source?.disconnect(); stream?.getTracks().forEach(track => track.stop()); if (context && context.state !== 'closed') await context.close() }
  try {
    signal.throwIfAborted()
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false })
    signal.throwIfAborted()
    context = new AudioContext({ latencyHint: 'interactive' })
    await context.audioWorklet.addModule(new URL('./captureWorklet.js', import.meta.url).href)
    await context.resume(); signal.throwIfAborted()
    const settings = stream.getAudioTracks()[0]?.getSettings()
    const inputLatency = settings && 'latency' in settings && typeof settings.latency === 'number' ? settings.latency : undefined
    const calibrate = () => {
      const before = performance.now(); const timestamp = context!.getOutputTimestamp(); const after = performance.now()
      return correlateRecordingClock({ originMs, beforeMs: before, afterMs: after, currentSeconds: context!.currentTime, timestamp, sampleRate: context!.sampleRate, baseLatency: context!.baseLatency, outputLatency: context!.outputLatency, inputLatency })
    }
    let correlation = calibrate()
    let calibratedSeconds = context.currentTime
    let appliedOffsetUs = correlation.offsetUs
    let previousStartUs = 0
    let previousFrame: number | undefined
    source = context.createMediaStreamSource(stream)
    node = new AudioWorkletNode(context, 'henji-explanation-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
    let acknowledge: (() => void) | undefined
    node.port.onmessage = (event: MessageEvent<{ stopped?: boolean; firstFrame?: number; samples?: Float32Array }>): void => {
      if (event.data.stopped) { acknowledge?.(); return }
      const { firstFrame, samples } = event.data
      if (firstFrame === undefined || !samples || !context || signal.aborted) return
      if (!stopped && context.currentTime - calibratedSeconds >= RECORDING_CLOCK_RECALIBRATION_SECONDS) {
        correlation = calibrate()
        calibratedSeconds = context.currentTime
      }
      const quantumUs = Math.ceil(128 * 1_000_000 / context.sampleRate)
      // 校准逐量子靠近新相关点，避免设备变化造成突跳或相邻块倒退。
      appliedOffsetUs += Math.max(-quantumUs, Math.min(quantumUs, correlation.offsetUs - appliedOffsetUs))
      const mappedStartUs = Math.max(0, appliedOffsetUs + Math.round(firstFrame * 1_000_000 / context.sampleRate))
      const monoStartUs = previousFrame !== undefined && firstFrame > previousFrame ? Math.max(previousStartUs + 1, mappedStartUs) : mappedStartUs
      // 排队投递的旧块也按采样帧到校准点的距离估计漂移，不能把“刚收到”当作刚采集。
      const ageSeconds = Math.max(Math.abs(firstFrame / context.sampleRate - calibratedSeconds), Math.abs((firstFrame + samples.length) / context.sampleRate - calibratedSeconds))
      const uncertaintyUs = correlation.uncertaintyUs + recordingClockDriftUncertainty(ageSeconds)
        + Math.abs(correlation.offsetUs - appliedOffsetUs) + Math.abs(monoStartUs - mappedStartUs)
      previousFrame = firstFrame; previousStartUs = monoStartUs
      onBlock({ firstFrame, samples, sampleRate: context.sampleRate, monoStartUs, uncertaintyUs })
    }
    source.connect(node); node.connect(context.destination) // Worklet output is silence; input is never monitored.
    stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => { if (!stopped) onInterrupt('麦克风已断开，录制已暂停。') }, { once: true }))
    context.onstatechange = (): void => { if (!stopped && context?.state === 'suspended') onInterrupt('麦克风已暂停，请继续录制。') }
    let stopping: Promise<void> | undefined
    const stop = (): Promise<void> => {
      if (stopping) return stopping
      stopped = true
      stopping = (async () => {
      // Release the physical track immediately; drain the final worklet batch before closing its clock.
      stream?.getTracks().forEach(track => track.stop())
      await new Promise<void>(resolve => { const timer = setTimeout(resolve, 250); acknowledge = () => { clearTimeout(timer); resolve() }; node?.port.postMessage('stop') })
      signal.removeEventListener('abort', abort); await release()
      })()
      return stopping
    }
    const abort = (): void => { void stop() }; signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) await stop()
    return { stop }
  } catch (error) { await release(); throw error }
}
import { correlateRecordingClock, RECORDING_CLOCK_RECALIBRATION_SECONDS, recordingClockDriftUncertainty } from '@/core/audioEdit/recordingClock'
