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
    const before = performance.now(); const timestamp = context.getOutputTimestamp(); const after = performance.now()
    const settings = stream.getAudioTracks()[0]?.getSettings()
    const inputLatency = settings && 'latency' in settings && typeof settings.latency === 'number' ? settings.latency : undefined
    const { offsetUs, uncertaintyUs } = correlateRecordingClock({ originMs, beforeMs: before, afterMs: after, currentSeconds: context.currentTime, timestamp, sampleRate: context.sampleRate, baseLatency: context.baseLatency, inputLatency })
    source = context.createMediaStreamSource(stream)
    node = new AudioWorkletNode(context, 'henji-explanation-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
    let acknowledge: (() => void) | undefined
    node.port.onmessage = (event: MessageEvent<{ stopped?: boolean; firstFrame?: number; samples?: Float32Array }>): void => {
      if (event.data.stopped) { acknowledge?.(); return }
      const { firstFrame, samples } = event.data
      if (firstFrame === undefined || !samples || !context || signal.aborted) return
      onBlock({ firstFrame, samples, sampleRate: context.sampleRate, monoStartUs: Math.max(0, offsetUs + Math.round(firstFrame * 1_000_000 / context.sampleRate)), uncertaintyUs })
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
import { correlateRecordingClock } from '@/core/audioEdit/recordingClock'
