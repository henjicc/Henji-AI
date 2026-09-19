import type {
  AudioEditExportRequest,
  AudioEditExportResult,
  AudioEditProcessorDescriptor,
  AudioEditPreviewChunk,
  AudioEditPreviewChunkRequest,
  AudioEditProjectCreateRequest,
  AudioEditProjectDocument,
  AudioEditProjectSummary,
  AudioEditTranscriptionRequest,
  AudioEditTranscriptionResult,
} from '@/core/audioEdit/types'

export interface AudioEditAsrModel {
  id: string
  providerId: string
  configured: boolean
  timestamps: boolean
  longAudio: boolean
}

export interface AudioEditPlatform {
  listProjects(): Promise<AudioEditProjectSummary[]>
  createProject(request: AudioEditProjectCreateRequest): Promise<AudioEditProjectDocument>
  getProject(projectId: string): Promise<AudioEditProjectDocument | null>
  saveProject(project: AudioEditProjectDocument): Promise<AudioEditProjectDocument>
  listAsrModels(): Promise<AudioEditAsrModel[]>
  transcribe(request: AudioEditTranscriptionRequest): Promise<AudioEditTranscriptionResult>
  exportProject(request: AudioEditExportRequest): Promise<AudioEditExportResult>
  listProcessors(): Promise<AudioEditProcessorDescriptor[]>
  preparePreviewChunk(request: AudioEditPreviewChunkRequest): Promise<AudioEditPreviewChunk>
  extractWaveform(source: string, bucketCount: number): Promise<{ rms: number[]; peak: number[]; durationSeconds: number }>
}
