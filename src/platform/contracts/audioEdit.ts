import type {
  AudioEditExportRequest,
  AudioEditExportResult,
  AudioEditProcessorDescriptor,
  AudioEditPreviewChunk,
  AudioEditPreviewChunkRequest,
  AudioEditSourceMetadata,
  AudioEditTranscriptionRequest,
  AudioEditTranscriptionResult,
  AudioEditSilenceRequest,
  AudioEditSuggestion,
  AudioEditTask,
} from '@/core/audioEdit/types'
import type { AudioWaveformPyramidRequest, AudioWaveformPyramidResult, AudioWaveformRangeRequest, AudioWaveformRangeResult } from './audioWaveform'

export interface AudioEditAsrModel {
  id: string
  providerId: string
  configured: boolean
  timestamps: boolean
  longAudio: boolean
}

/**
 * 口播平台能力（3.3）：口播是 `.henji-audio` 文档，新建、打开、保存、改名、删除走通用文档接口（documents）；
 * 这里的 projectId 都是口播文档 ID。主进程按文档 ID 读文件执行转写、分析、处理、试听与导出，
 * 发起前渲染层先把修改写完；转写与重新定位的结果返回给渲染层实例，由文档会话保存。
 */
export interface AudioEditPlatform {
  /** 导入音频或视频：探测素材并计算内容指纹（不建文档）。 */
  probeSource(sourcePath: string): Promise<AudioEditSourceMetadata>
  verifySource(projectId: string): Promise<void>
  /** 确认所选文件与原素材内容相同，返回新的素材信息（不写文档）。 */
  relinkSource(projectId: string, sourcePath: string): Promise<AudioEditSourceMetadata>
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
  /** Whole-source multi-resolution peaks, cached by content in the main process (task 2.3). */
  extractWaveformPyramid(request: AudioWaveformPyramidRequest, signal?: AbortSignal): Promise<AudioWaveformPyramidResult>
}
