import type { WaveformPyramidData } from '../../../../src/core/media/waveformPyramid'
import type { AudioWaveformChannel } from '../../../../src/platform/contracts/audioWaveform'

export interface ExtractAudioSamplesResultDto {
  rms: number[]
  peak: number[]
  durationSeconds: number
}

export type { AudioWaveformRangeRequest, AudioWaveformRangeResult, AudioWaveformChannel, AudioWaveformPyramidRequest, AudioWaveformPyramidResult } from '../../../../src/platform/contracts/audioWaveform'

/** 按任意桶数聚合一段采样（区间波形）；`keepSamples` 同时保留原始采样（精细档）。 */
export interface AudioWaveformAggregationOptions {
  kind?: 'buckets'
  channels: 1 | 2
  bucketCount: number
  expectedFrames: number
  keepSamples?: boolean
}

/** 整段生成多级峰值；级规划由主进程按共享常量传入，Worker 不导入运行时模块。 */
export interface AudioWaveformPyramidOptions {
  kind: 'pyramid'
  /** 交织声道数（声音流原声道或 FFmpeg 混音后的声道）。 */
  channels: number
  /** 追加一个各声道平均的单声道混合声道。 */
  mix: boolean
  expectedFrames: number
  sampleRate: number
  startSeconds: number
  endSeconds: number
  nativeChannels: number
  baseSamplesPerBucket: number
  levelFactor: number
  topBuckets: number
}

export type AudioWaveformWorkerOptions = AudioWaveformAggregationOptions | AudioWaveformPyramidOptions

export interface AudioWaveformPyramidOutput {
  /** 原声道的最粗一级摘要（线性值），与区间聚合同形，便于观测。 */
  channels: AudioWaveformChannel[]
  pyramid: WaveformPyramidData
}

export interface AudioWaveformWorkerRequest {
  id: number
  type: 'start' | 'chunk' | 'finish'
  options?: AudioWaveformWorkerOptions
  bytes?: Uint8Array
}
