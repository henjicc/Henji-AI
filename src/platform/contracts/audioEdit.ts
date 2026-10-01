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
  AudioEditSilenceRequest,
  AudioEditSuggestion,
  AudioEditTask,
} from '@/core/audioEdit/types'
import type { AudioWaveformRangeRequest, AudioWaveformRangeResult } from './audioWaveform'

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
  verifySource(projectId: string): Promise<void>
  relinkSource(projectId: string, sourcePath: string): Promise<AudioEditProjectDocument>
  deleteProject(projectId: string): Promise<void>
  detectSilence(request: AudioEditSilenceRequest): Promise<{ revision: number; suggestions: AudioEditSuggestion[] }>
  listTasks(projectId: string): Promise<AudioEditTask[]>
  cancelTask(requestId: string): Promise<void>
  prepareProcessing(projectId: string, requestId: string): Promise<void>
  listAsrModels(): Promise<AudioEditAsrModel[]>
  transcribe(request: AudioEditTranscriptionRequest): Promise<AudioEditTranscriptionResult>
  exportProject(request: AudioEditExportRequest): Promise<AudioEditExportResult>
  listProcessors(): Promise<AudioEditProcessorDescriptor[]>
  preparePreviewChunk(request: AudioEditPreviewChunkRequest): Promise<AudioEditPreviewChunk>
  extractWaveform(source: string, bucketCount: number): Promise<{ rms: number[]; peak: number[]; durationSeconds: number }>
  extractWaveformRange(request: AudioWaveformRangeRequest, signal?: AbortSignal): Promise<AudioWaveformRangeResult>
}
