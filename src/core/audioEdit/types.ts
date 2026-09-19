export type AudioEditPreviewMode = 'edited' | 'source'

export interface AudioEditTranscriptBlock {
  id: string
  text: string
  startFrame: number
  endFrame: number
  confidence?: number
  included: boolean
  locked: boolean
  granularity: 'word' | 'segment'
}

export interface AudioEditTimelineSpan {
  sourceStartFrame: number
  sourceEndFrame: number
  outputStartFrame: number
  outputEndFrame: number
}

export interface AudioEditSuggestion {
  id: string
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
}

export interface AudioEditTranscriptionResult {
  project: AudioEditProjectDocument
  modelId: string
  granularity: 'word' | 'segment' | 'none'
}

export interface AudioEditExportRequest {
  projectId: string
  audioTargetPath: string
  subtitleTargetPath?: string
}

export interface AudioEditExportResult {
  audioPath: string
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
}

export interface AudioEditPreviewChunk {
  sourceStartFrame: number
  sourceEndFrame: number
  sampleRate: number
  channels: number
  pcm: ArrayBuffer
}
