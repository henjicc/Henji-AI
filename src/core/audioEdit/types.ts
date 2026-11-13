import type { SpeechEnergyAnalysis, SpeechEnergyOptions } from './speechEnergy'

export type AudioEditPreviewMode = 'edited' | 'source' | 'delivery'

export interface AudioEditRange { startFrame: number; endFrame: number }
export interface AudioEditCut extends AudioEditRange { id: string; reason: 'silence' | 'manual'; enabled: boolean; mode?: 'delete' | 'mute' }
export interface AudioEditViewSettings { textSize: number; sidePadding: number; timelineCaptions: boolean }
export interface AudioEditFrameRate { numerator: number; denominator: number }
/** 整文件 SHA-256 的素材身份：格式 8 之前导入的作品带它；之后导入、拼接、重新定位的素材写 AudioEditSourceFingerprint。 */
export interface AudioEditSourceIdentity { size: number; mtimeMs: number; digest: string }
/**
 * 素材指纹：大小、修改时间与采样摘要（henji-audio-fingerprint-v1：16 MiB 以内整文件，更大的文件取头尾与均匀分布的定长块）。
 * 校验先比大小与修改时间，不同才重算摘要比对；读量与文件大小无关。
 */
export interface AudioEditSourceFingerprint { size: number; mtimeMs: number; digest: string }
export interface AudioEditBatchSettings {
  silenceThresholdMs: number
  retainedSilenceMs: number
  noiseDb: number
  trimEdges: boolean
  fillers: string[]
}
interface AudioEditVideoMetadata {
  frameRate: AudioEditFrameRate
  width: number
  height: number
  startSeconds: number
  durationSeconds: number
  variableFrameRate: boolean
}

export interface AudioEditTranscriptBlock {
  id: string
  text: string
  startFrame: number
  endFrame: number
  confidence?: number
  included: boolean
  locked: boolean
  granularity: 'word' | 'segment'
  /** Subtitle boundary; does not replace the recognized word timing. */
  captionBreakAfter?: boolean
}

export interface AudioEditBaseline {
  kind: 'original' | 'legacy'
  transcript: AudioEditTranscriptBlock[]
  suggestions: AudioEditSuggestion[]
}

export interface AudioEditTimelineSpan {
  muted?: boolean
  sourceStartFrame: number
  sourceEndFrame: number
  outputStartFrame: number
  outputEndFrame: number
}

export interface AudioEditSuggestion {
  id: string
  evidence?: 'audio'
  kind: 'long_silence' | 'filler' | 'retake'
  title: string
  detail: string
  startFrame: number
  endFrame: number
  blockIds: string[]
  confidence: 'high' | 'medium' | 'low'
  status: 'pending' | 'applied' | 'dismissed'
}

/** 一处重念可以怎么剪：一种做法要删哪些词、连带剪掉的声音范围。blockIds 为空表示都留着。 */
export interface AudioEditSuggestionOption {
  /** keep_later 留后一遍、keep_earlier 留前一遍、splice_<切点两头词块的摘要> 换个切点拼接、keep_both 都留着 */
  id: string
  blockIds: string[]
  startFrame: number
  endFrame: number
}

/**
 * 本地粗剪交给助手（或人）二次判断的材料，按线索 ID 存：为什么判成重念或为什么拿不准、有多像、还能怎么剪。
 * 单独成一张表而不写进线索本身：线索是严格结构，往里加字段会让旧版本程序打不开文件；顶层不认识的字段旧版本会原样带回。
 */
export interface AudioEditSuggestionHandoff {
  reason?: string
  /** 0–1，越大越像念坏重来；只用来排先后 */
  score?: number
  options?: AudioEditSuggestionOption[]
  /** 助手看过仍定不了、留给用户听的 */
  audience?: 'user'
  /** 改判时选的做法；没有改判过的不记，用的是排在第一的那种 */
  chosen?: string
}

export interface AudioEditSourceMetadata {
  mediaType: 'audio' | 'video'
  sourcePath: string
  audioPath: string
  durationFrames: number
  sampleRate: number
  channels: number
  ownership?: 'external' | 'managed'
  identity?: AudioEditSourceIdentity
  fingerprint?: AudioEditSourceFingerprint
  audioStreamIndex?: number
  audioStartSeconds?: number
  video?: AudioEditVideoMetadata
}

/**
 * 口播在工具内存里的形态（3.3 起存成 `.hjaud` 文档）：id / name / createdAt / updatedAt / revision 来自文档外壳，
 * 其余字段是文档内容（见 `documentContent.ts`）。
 */
export interface AudioEditProjectDocument {
  id: string
  name: string
  source: AudioEditSourceMetadata
  referenceScript: string
  transcript: AudioEditTranscriptBlock[]
  suggestions: AudioEditSuggestion[]
  suggestionHandoff?: Record<string, AudioEditSuggestionHandoff>
  selectedAsrModelId?: string
  createdAt: number
  updatedAt: number
  revision: number
  gainRegions?: import('./regions').AudioEditGainRegion[]
  repairs?: import('./regions').AudioEditRepair[]
  cuts?: AudioEditCut[]
  batchSettings?: AudioEditBatchSettings
  xmlFrameRate?: AudioEditFrameRate
  viewSettings?: AudioEditViewSettings
  editBaseline?: AudioEditBaseline
  /** 效果控件：有顺序的效果链，从上到下处理录音本身（见 `./effects`）。 */
  effectChain?: import('./effects').AudioEditChainItem[]
  /** 效果控件整体关闭（对比处理前后；输出一节照常）。 */
  chainBypassed?: boolean
  /** 输出：作用在剪好的整条声音上的音量与自动匹配响度。 */
  output?: import('./effects').AudioEditOutput
}

export interface AudioEditTranscriptionRequest {
  projectId: string
  modelId?: string
  language?: string
  requestId?: string
}

export interface AudioEditTranscriptionResult {
  project: AudioEditProjectDocument
  modelId: string
  granularity: 'word' | 'segment' | 'none'
}

export interface AudioEditExportRequest {
  projectId: string
  audioTargetPath?: string
  targetPath?: string
  format?: 'xml' | 'wav'
  frameRate?: AudioEditFrameRate
  subtitleTargetPath?: string
  requestId?: string
}

export interface AudioEditExportResult {
  audioPath: string
  xmlPath?: string
  subtitlePath?: string
  durationFrames: number
}

export interface AudioEditProcessorDescriptor {
  id: string
  name: string
  vendor: string
  version: string
  available: boolean
  semanticRole?: 'mouth_declick' | 'voice_denoise' | 'breath_control'
  latencyFrames?: number
  parameters?: Array<{
    id: number
    name: string
    normalizedValue: number
    displayValue: string
  }>
  reason?: string
}

export interface AudioEditPreviewChunkRequest {
  mode?: 'source' | 'edited'
  projectId: string
  sourceStartFrame: number
  frameCount: number
}

export type AudioEditSilenceRequest = ({ projectId: string; sourcePath?: never } | { sourcePath: string; projectId?: never }) & {
  settings: AudioEditBatchSettings
  range?: AudioEditRange
  requestId?: string
  /** Adaptive acoustic evidence, independent of ASR; no recognition or document mutation. */
  energy?: SpeechEnergyOptions
}

export interface AudioEditSilenceResult {
  revision: number
  suggestions: AudioEditSuggestion[]
  energy?: SpeechEnergyAnalysis
}

export interface AudioEditTask {
  requestId: string
  projectId: string
  kind: string
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress?: number
  errorMessage?: string
}

export interface AudioEditPreviewChunk {
  sourceStartFrame: number
  sourceEndFrame: number
  sampleRate: number
  channels: number
  pcm: ArrayBuffer
}
