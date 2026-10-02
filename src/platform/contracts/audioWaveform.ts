/** Source-clock microseconds; the range is [startUs, endUs). */
export interface AudioWaveformRangeRequest {
  source: string
  sourceRevision?: string
  startUs: number
  endUs: number
  bucketCount: number
  channels: 1 | 2
  /** The n-th sound stream of the file in file order (default the first). */
  audioStream?: number
  /** Only this channel of the stream (needs `channels: 1`); default all channels mixed to `channels`. */
  audioChannel?: number
}

export interface AudioWaveformChannel {
  /** Linear PCM amplitude, without display normalization or clipping at 1. */
  peak: number[]
  rms: number[]
  sampleCounts: number[]
}

export interface AudioWaveformRangeResult {
  startUs: number
  endUs: number
  durationSeconds: number
  sampleRate: number
  channelCount: 1 | 2
  channels: AudioWaveformChannel[]
  fileIdentity: string
  sourceRevision?: string
}
