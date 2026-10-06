import type { VideoEditClipAudio, VideoEditAudioChunk } from './videoEditFrameSource'
/** Present a mixed sequence to the existing anti-aliased speed/reverse resampler as an ordinary sound source. */
export function videoEditNestedAudio(rate: number, duration: number, mix: (start: number, duration: number) => Promise<Float32Array[]>): VideoEditClipAudio {
  return { async *chunks(from: number, to: number): AsyncGenerator<VideoEditAudioChunk> {
    const end = Math.min(Math.ceil(duration * rate - 1e-7), Math.ceil(to * rate - 1e-7))
    for (let first = Math.max(0, Math.ceil(from * rate - 1e-7)); first < end;) {
      const length = Math.min(rate, end - first)
      const planes = await mix(first / rate, length / rate)
      yield { timestamp: first / rate, duration: length / rate, sampleRate: rate, numberOfChannels: planes.length, numberOfFrames: length,
        copyTo(destination: Float32Array, options: { planeIndex: number }): void { destination.set(planes[options.planeIndex]) }, close(): void {},
      }
      first += length
    }
  } }
}
