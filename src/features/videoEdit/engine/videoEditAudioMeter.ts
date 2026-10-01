export interface VideoEditAudioLevel { peak: number; rms: number }

/** Measures samples pulled by the actual playback graph, after the formal mix. */
export function createVideoEditAudioMeter(context: AudioContext, channels: 1 | 2): { input: GainNode; read: () => VideoEditAudioLevel[]; dispose: () => void } {
  const input = context.createGain(); input.channelCount = channels; input.channelCountMode = 'explicit'; input.connect(context.destination)
  const splitter = context.createChannelSplitter(channels); input.connect(splitter)
  const silent = context.createGain(); silent.gain.value = 0; silent.connect(context.destination)
  const analysers = Array.from({ length: channels }, (_, channel) => {
    const analyser = context.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0
    splitter.connect(analyser, channel); analyser.connect(silent)
    return { analyser, samples: new Float32Array(analyser.fftSize) }
  })
  let disposed = false
  return {
    input,
    read: () => analysers.map(({ analyser, samples }) => {
      if (disposed) return { peak: 0, rms: 0 }
      analyser.getFloatTimeDomainData(samples)
      let peak = 0; let sum = 0
      for (const sample of samples) { const value = Number.isFinite(sample) ? sample : 0; peak = Math.max(peak, Math.abs(value)); sum += value * value }
      return { peak, rms: Math.sqrt(sum / samples.length) }
    }),
    dispose: () => { if (disposed) return; disposed = true; input.disconnect(); splitter.disconnect(); for (const { analyser } of analysers) analyser.disconnect(); silent.disconnect() },
  }
}
