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
  /** Also return the signed PCM samples of the range (detail tier; bounded by WAVEFORM_DETAIL_MAX_FRAMES). */
  samples?: boolean
}

export interface AudioWaveformChannel {
  /** Linear PCM amplitude, without display normalization or clipping at 1. */
  peak: number[]
  rms: number[]
  sampleCounts: number[]
  /** Signed PCM samples from the first sample index of the range (only with `samples: true`). */
  samples?: Float32Array
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

/** Whole-source multi-resolution peaks (task 2.3). Channel selection matches the range request. */
export interface AudioWaveformPyramidRequest {
  source: string
  sourceRevision?: string
  channels: 1 | 2
  audioStream?: number
  audioChannel?: number
  /** Only levels with at most this many buckets (the coarsest level is always included). */
  maxBuckets?: number
  /** The `version` already held; an unchanged source answers `notModified`. */
  ifNoneMatch?: string
}

export interface AudioWaveformPyramidLevelDto {
  samplesPerBucket: number
  bucketCount: number
  /** Per selected channel, 16-bit fixed point: linear = value × amplitudeScale / 65535. */
  peak: Uint16Array[]
  rms: Uint16Array[]
}

export interface AudioWaveformPyramid {
  /** Content version (file identity + stream + channel selection); changes when the file changes. */
  version: string
  sampleRate: number
  /** Sample 0 is at absolute source time 0. */
  frameCount: number
  /** Container start on the absolute clock (start of the whole-file view). */
  startSeconds: number
  /** Absolute end, the measure of imported media duration. */
  endSeconds: number
  amplitudeScale: number
  /** Largest linear peak of the selected channels. */
  peakMax: number
  channelCount: number
  levels: AudioWaveformPyramidLevelDto[]
}

export type AudioWaveformPyramidResult = AudioWaveformPyramid | { notModified: true; version: string }
