export interface ExtractAudioSamplesResultDto {
  rms: number[]
  peak: number[]
  durationSeconds: number
}

export type { AudioWaveformRangeRequest, AudioWaveformRangeResult, AudioWaveformChannel } from '../../../../src/platform/contracts/audioWaveform'

export interface AudioWaveformAggregationOptions {
  format: 's16le' | 'f32le'
  channels: 1 | 2
  bucketCount: number
  expectedFrames: number
}

export interface AudioWaveformWorkerRequest {
  id: number
  type: 'start' | 'chunk' | 'finish'
  options?: AudioWaveformAggregationOptions
  bytes?: Uint8Array
}
