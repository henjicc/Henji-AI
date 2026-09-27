export type AudioEditPreviewMode = 'edited' | 'source' | 'delivery'

export interface AudioEditRange { startFrame: number; endFrame: number }
export interface AudioEditCut extends AudioEditRange { id: string; reason: 'silence' | 'manual'; enabled: boolean; mode?: 'delete' | 'mute' }
export interface AudioEditViewSettings { textSize: number; sidePadding: number; timelineCaptions: boolean }
export interface AudioEditFrameRate { numerator: number; denominator: number }
export interface AudioEditSourceIdentity { size: number; mtimeMs: number; digest: string }
export interface AudioEditProcessorSetting { id: string; enabled: boolean; parameters: Record<string, number> }
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

export interface AudioEditProjectDocument {
  id: string
  name: string
  source: AudioEditSourceMetadata
  referenceScript: string
  transcript: AudioEditTranscriptBlock[]
  suggestions: AudioEditSuggestion[]
  vstEnabled: boolean
  selectedAsrModelId?: string
  createdAt: number
  updatedAt: number
  revision: number
  cuts?: AudioEditCut[]
  batchSettings?: AudioEditBatchSettings
  processorChain?: AudioEditProcessorSetting[]
  xmlFrameRate?: AudioEditFrameRate
  viewSettings?: AudioEditViewSettings
  editBaseline?: AudioEditBaseline
}

export interface AudioEditProjectSummary {
  id: string
  name: string
  mediaType: AudioEditSourceMetadata['mediaType']
  durationFrames: number
  sampleRate: number
  updatedAt: number
}

export interface AudioEditProjectCreateRequest {
  sourcePath: string
  name?: string
  referenceScript?: string
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
  includeProcessing?: boolean
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
  projectId: string
  sourceStartFrame: number
  frameCount: number
  processing?: boolean
}

export interface AudioEditSilenceRequest {
  projectId: string
  settings: AudioEditBatchSettings
  range?: AudioEditRange
  requestId?: string
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
