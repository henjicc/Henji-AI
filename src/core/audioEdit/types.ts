import type { SpeechEnergyAnalysis, SpeechEnergyOptions } from './speechEnergy'

export type AudioEditPreviewMode = 'edited' | 'source' | 'delivery'

export interface AudioEditRange { startFrame: number; endFrame: number }
export interface AudioEditCut extends AudioEditRange { id: string; reason: 'silence' | 'manual'; enabled: boolean; mode?: 'delete' | 'mute' }
export interface AudioEditViewSettings { textSize: number; sidePadding: number; timelineCaptions: boolean }
export interface AudioEditFrameRate { numerator: number; denominator: number }
export interface AudioEditSourceIdentity { size: number; mtimeMs: number; digest: string }
export interface AudioEditBatchSettings {
  silenceThresholdMs: number
  retainedSilenceMs: number
  noiseDb: number
  trimEdges: boolean
  fillers: string[]
}
export interface AudioEditVideoMetadata {
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

export interface AudioEditSourceMetadata {
  mediaType: 'audio' | 'video'
  sourcePath: string
  audioPath: string
  durationFrames: number
  sampleRate: number
  channels: number
  ownership?: 'external' | 'managed'
  identity?: AudioEditSourceIdentity
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
