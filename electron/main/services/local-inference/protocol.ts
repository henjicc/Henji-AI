import type { SmartRegionAnalysisKind, SmartRegionSummary } from '../../../../src/core/videoEdit/smartRegions'
import type { LocalExecutionProvider } from './providers'
import type { OnnxExtraOutput } from './tracking/onnxGraphOutputs'
import type { TrackingCandidatesJob, TrackingCandidatesResult, TrackingJob, TrackingJobResult } from './tracking/trackingProtocol'
import type { TrackingFrameReply, TrackingFrameRequest } from '../../../../src/platform/contracts/tracking'
import type { ImageInpaintJob, ImageInpaintResult } from './inpainting/protocol'

/*
 * 主进程 ↔ 本地推理后台进程（utility process）的消息。主进程负责解析素材、准备模型与缓存位置，
 * 后台进程负责解码取帧、推理、写结果文件；进度、日志、结果都回传主进程，由主进程写结构化日志。
 */

export type LocalInferenceModelName = 'yunet' | 'rvm' | 'selfie' | 'ppocr'
  | 'etam_image_encoder' | 'etam_mask_decoder' | 'etam_memory_encoder' | 'etam_memory_attention' | 'etam_mask_downsample' | 'vittrack'
  | 'migan' | 'lama'

export interface LocalInferenceModelFile {
  name: LocalInferenceModelName
  path: string
  /** 载入时补成图输出的内部张量（不改模型文件；EfficientTAM 解码器的 4 个候选掩码）。 */
  extraOutputs?: OnnxExtraOutput[]
}

export interface SmartRegionAnalysisJob {
  id: string
  kind: SmartRegionAnalysisKind
  /** 按优先顺序：人物先 RVM，失败退 Selfie。 */
  models: LocalInferenceModelFile[]
  ffmpegPath: string
  source: string
  /** 相对容器起点的定位时间（秒，交给 FFmpeg -ss）；静态图片为 0。 */
  seekSeconds: number
  /** 分析时长（秒）；静态图片为 null。 */
  durationSeconds: number | null
  /** 素材绝对时钟上的起止（微秒），写进结果文件。 */
  startUs: number
  endUs: number
  fps: number
  /** 显示画面尺寸（已按旋转与像素比换算）。 */
  display: { width: number; height: number }
  /** 结果写到这个临时文件，主进程收到完成消息后原子改名进缓存。 */
  outputPath: string
  providers: LocalExecutionProvider[]
}

export type LocalInferenceFailureCode = 'decode' | 'inference' | 'output' | 'cancelled'

export type LocalInferenceRequest =
  | { type: 'analyze'; job: SmartRegionAnalysisJob }
  | { type: 'inpaint'; job: ImageInpaintJob }
  | { type: 'track'; job: TrackingJob }
  | { type: 'candidates'; job: TrackingCandidatesJob }
  | { type: 'cancel'; id: string }
  | { type: 'frames'; id: string; reply: TrackingFrameReply }

export interface SmartRegionAnalysisResult {
  model: LocalInferenceModelName
  provider: LocalExecutionProvider
  frames: number
  summary: SmartRegionSummary
  /** 等待解码帧、推理（含预处理与后处理）的累计毫秒。 */
  decodeMs: number
  inferenceMs: number
  durationMs: number
}

export type LocalInferenceEvent =
  | { type: 'frames'; id: string; requestId: string; request: TrackingFrameRequest }
  | { type: 'progress'; id: string; done: number; total: number }
  | { type: 'done'; id: string; result: SmartRegionAnalysisResult | TrackingJobResult | TrackingCandidatesResult | ImageInpaintResult }
  | { type: 'failed'; id: string; code: LocalInferenceFailureCode; message: string }
  | { type: 'log'; level: 'info' | 'warn'; message: string; event: string; context: Record<string, unknown> }
