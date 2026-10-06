import type { LocalInferenceModelFile } from '../protocol'
import type { LocalExecutionProvider } from '../providers'
import type { VideoEditTrackMethod, VideoEditTrackQuad, VideoEditTrackPrompt } from '../../../../../src/core/videoEdit/tracking'

/*
 * 跟踪任务（任务 4.10）：主进程准备参数（素材、模型、帧网格、已有结果），本地推理后台进程取帧、推理、写结果文件。
 * 帧号都在素材绝对时钟的帧网格上（第 k 帧 = k / fps 秒）；坐标是显示画面的归一化坐标。
 */

export interface TrackingJobPrompt {
  frame: number
  points?: Array<[number, number, 0 | 1]>
  box?: [number, number, number, number]
  candidate?: number
  quad?: VideoEditTrackQuad
  window?: VideoEditTrackPrompt['window']
}

export interface TrackingJob {
  id: string
  method: VideoEditTrackMethod
  models: LocalInferenceModelFile[]
  ffmpegPath: string
  source: string
  /** 容器起点（微秒）：帧网格是素材绝对时钟，交给 FFmpeg 定位前要减去。 */
  containerStartUs: number
  fps: number
  display: { width: number; height: number }
  /** 按帧号排序。 */
  prompts: TrackingJobPrompt[]
  /** 允许跟踪到的帧范围（片段用到的素材范围，含提示帧）。 */
  range: { first: number; last: number }
  /** both：先向后再向前，跟满范围；forward / backward：只朝一个方向。 */
  direction: 'both' | 'forward' | 'backward'
  /** 每个方向最多新跟踪几帧（“向前一帧”为 1）；不写跟到范围边界。 */
  limit?: number
  /** 同一跟踪定义的已有结果（从覆盖范围的边界接着跟）；没有为 undefined。 */
  existingPath?: string
  outputPath: string
  providers: LocalExecutionProvider[]
}

export interface TrackingJobResult {
  model: string
  provider: LocalExecutionProvider
  firstFrame: number
  frameCount: number
  /** 这次新跟踪的帧数。 */
  tracked: number
  /** 中途停止（停止按钮）：已跟踪的部分照样写出。 */
  stopped: boolean
  summary: { tracked: number; lost: number }
  decodeMs: number
  inferenceMs: number
  durationMs: number
}

/** 点选候选：在一帧上点一个点，给出 3 个候选掩码（128×128 logit，int8 × 4）与模型给的可信度。 */
export interface TrackingCandidatesJob {
  id: string
  models: LocalInferenceModelFile[]
  ffmpegPath: string
  source: string
  containerStartUs: number
  fps: number
  frame: number
  points: Array<[number, number, 0 | 1]>
  providers: LocalExecutionProvider[]
}

export interface TrackingCandidatesResult {
  provider: LocalExecutionProvider
  size: number
  candidates: Array<{ logits: Int8Array; score: number }>
}
