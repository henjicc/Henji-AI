import { z } from 'zod'
import { BrowserWindow } from 'electron'
import { audioEditSpectralTileRequestSchema } from '../../../src/core/audioEdit/spectralPyramid'
import { getAudioEditSpectralTile, cancelAudioEditSpectralTile, subscribeAudioEditSpectralProgress } from '../services/audio-edit/spectral-pyramid'
import { audioEditSpectrogramRequestSchema } from '../../../src/core/audioEdit/regions'
import { getAudioEditSpectrogram } from '../services/audio-edit/spectrogram'
import { renderAudioEditProject, prepareAudioEditRenderSource } from '../services/audio-edit/render'
import { registerAudioSampleHandlers } from './audio-samples'
import { registerExplanationAudioHandlers } from './explanation-audio'
import { registerAudioLoudnessHandlers } from './audio-loudness'
import { parseRecord, parseStringField, parseVoid, registerIpcHandler } from './registry'
import { probeAudioEditImport, relinkAudioEditSource, verifyAudioEditSource } from '../services/audio-edit/media'
import { detectAudioEditSilence } from '../services/audio-edit/silence'
import { speechEnergyOptionsSchema } from '../../../src/core/audioEdit/speechEnergy'
import { cancelAudioEditTask, listAudioEditTasks, runAudioEditTask } from '../services/audio-edit/task-store'
import { audioEditSettingsSchema, audioEditRangeSchema, audioEditFrameRateSchema } from '../../../src/core/audioEdit/schema'
import { requireAudioEditProject } from '../services/audio-edit/project-store'
import { listAudioEditAsrModels, transcribeAudioEditProject, preflightAudioEditTranscription } from '../services/audio-edit/asr'
import { transcriptionPreflightSchema } from '../../../src/core/audioEdit/transcriptionFailure'
import { exportAudioEditProject } from '../services/audio-edit/export'
import { listAudioEditProcessors } from '../services/audio-edit/processors'
import { prepareAudioEditPreviewChunk } from '../services/audio-edit/preview'
import type {
  AudioEditExportRequest,
  AudioEditPreviewChunkRequest,
  AudioEditTranscriptionRequest,
} from '../../../src/core/audioEdit/types'

/*
 * 口播 IPC（3.3 口播接入）：口播是 `.henji-audio` 文档，新建、打开、保存、改名、删除都走通用文档接口；
 * 这里只剩导入时探测素材，以及按文档 ID（参数名沿用 projectId）执行的转写、分析、处理、试听与导出。
 */
export function registerAudioIpc(): void {
  registerIpcHandler('audioEdit:spectralTile', input => audioEditSpectralTileRequestSchema.parse(input), getAudioEditSpectralTile)
  registerIpcHandler('audioEdit:spectralCancel', input => z.object({ requestId: z.string().min(1).max(200) }).strict().parse(input), ({ requestId }) => cancelAudioEditSpectralTile(requestId))
  subscribeAudioEditSpectralProgress(progress => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('audioEdit:spectralProgress', progress)
    }
  })
  registerIpcHandler('audioEdit:spectrogram', input => audioEditSpectrogramRequestSchema.parse(input), getAudioEditSpectrogram)
  registerIpcHandler('audioEdit:render', input => z.object({ projectId: z.string().min(1), requestId: z.string().optional(), includeProcessing: z.boolean().optional() }).strict().parse(input), async request => {
    const project = await requireAudioEditProject(request.projectId)
    return runAudioEditTask(project.id, 'render', signal => renderAudioEditProject(project, request.includeProcessing ?? project.vstEnabled, signal), request.requestId, JSON.stringify([project, request.includeProcessing]), true)
  })
  // 修复与区间音量已生效、删除/静音尚未套用的音频：时间轴与原素材一致，波形视图据此显示编辑后的样子。
  registerIpcHandler('audioEdit:editedSource', input => z.object({ projectId: z.string().min(1), requestId: z.string().optional() }).strict().parse(input), async request => {
    const project = await requireAudioEditProject(request.projectId)
    const audioPath = await runAudioEditTask(project.id, 'render', signal => prepareAudioEditRenderSource(project, false, signal), request.requestId, JSON.stringify(['edited-source', project.repairs, project.gainRegions, project.source]), true)
    return { audioPath }
  })
  registerAudioSampleHandlers()
  registerExplanationAudioHandlers()
  registerAudioLoudnessHandlers()

  registerIpcHandler('audioEdit:source:probe', input => {
    const record = parseRecord(input)
    return { sourcePath: readString(record, 'sourcePath'), requestId: readOptionalString(record, 'requestId') }
  }, ({ sourcePath, requestId }) => probeAudioEditImport(sourcePath, requestId))
  registerIpcHandler('audioEdit:asr:list', parseVoid, () => listAudioEditAsrModels())
  registerIpcHandler('audioEdit:asr:preflight', input => transcriptionPreflightSchema.parse(input), preflightAudioEditTranscription)
  registerIpcHandler('audioEdit:source:verify', (input) => parseStringField(input, 'projectId'), async (id) => verifyAudioEditSource(await requireAudioEditProject(id)))
  registerIpcHandler('audioEdit:source:relink', (input) => {
    const record = parseRecord(input)
    return { projectId: readString(record, 'projectId'), sourcePath: readString(record, 'sourcePath') }
  }, ({ projectId, sourcePath }) => relinkAudioEditSource(projectId, sourcePath))
  registerIpcHandler('audioEdit:silence', (input) => {
    const record = parseRecord(input)
    if (record.projectId !== undefined && record.sourcePath !== undefined) throw new Error('只提供 projectId 或 sourcePath。')
    const target = record.sourcePath === undefined ? { projectId: readString(record, 'projectId') } : { sourcePath: readString(record, 'sourcePath') }
    return { ...target, settings: audioEditSettingsSchema.parse(record.settings), range: record.range === undefined ? undefined : audioEditRangeSchema.parse(record.range), requestId: readOptionalString(record, 'requestId'), energy: record.energy === undefined ? undefined : speechEnergyOptionsSchema.parse(record.energy) }
  }, detectAudioEditSilence)
  registerIpcHandler('audioEdit:tasks:list', (input) => parseStringField(input, 'projectId'), listAudioEditTasks)
  registerIpcHandler('audioEdit:tasks:cancel', (input) => parseStringField(input, 'requestId'), cancelAudioEditTask)
  registerIpcHandler('audioEdit:processing', (input) => {
    const record = parseRecord(input)
    return { projectId: readString(record, 'projectId'), requestId: readString(record, 'requestId') }
  }, async ({ projectId, requestId }) => {
    const project = await requireAudioEditProject(projectId)
    return runAudioEditTask(projectId, 'processing', async (signal, progress) => {
      await verifyAudioEditSource(project)
      await prepareAudioEditRenderSource(project, true, signal)
      progress(1)
    }, requestId, JSON.stringify([project.source.identity, project.processorChain]))
  })
  registerIpcHandler('audioEdit:asr:transcribe', parseTranscription, transcribeAudioEditProject)
  registerIpcHandler('audioEdit:export', parseExport, exportAudioEditProject)
  registerIpcHandler('audioEdit:processors:list', parseVoid, () => listAudioEditProcessors())
  registerIpcHandler<AudioEditPreviewChunkRequest, Awaited<ReturnType<typeof prepareAudioEditPreviewChunk>>>(
    'audioEdit:preview:chunk', parsePreviewChunk, prepareAudioEditPreviewChunk,
  )
}

function parsePreviewChunk(input: unknown): AudioEditPreviewChunkRequest {
  const record = parseRecord(input)
  return {
    projectId: readString(record, 'projectId'),
    mode: record.mode === 'source' ? 'source' : 'edited',
    sourceStartFrame: readNumber(record, 'sourceStartFrame'),
    frameCount: readNumber(record, 'frameCount'),
    processing: record.processing === undefined ? undefined : readBoolean(record, 'processing'),
  }
}

function parseTranscription(input: unknown): AudioEditTranscriptionRequest {
  const record = parseRecord(input)
  return {
    projectId: readString(record, 'projectId'),
    modelId: readOptionalString(record, 'modelId'),
    language: readOptionalString(record, 'language'),
    requestId: readOptionalString(record, 'requestId'),
  }
}

function parseExport(input: unknown): AudioEditExportRequest {
  const record = parseRecord(input)
  if (record.format !== undefined && record.format !== 'xml' && record.format !== 'wav') throw new Error('导出格式无效')
  return {
    projectId: readString(record, 'projectId'),
    audioTargetPath: readOptionalString(record, 'audioTargetPath'),
    targetPath: readOptionalString(record, 'targetPath'),
    format: record.format,
    includeProcessing: record.includeProcessing === undefined ? undefined : readBoolean(record, 'includeProcessing'),
    frameRate: record.frameRate === undefined ? undefined : audioEditFrameRateSchema.parse(record.frameRate),
    requestId: readOptionalString(record, 'requestId'),
    subtitleTargetPath: readOptionalString(record, 'subtitleTargetPath'),
  }
}

function readBoolean(record: Record<string, unknown>, field: string): boolean {
  const value = record[field]
  if (typeof value !== 'boolean') throw new Error(`Expected boolean field "${field}"`)
  return value
}

function readString(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Expected non-empty string field "${field}"`)
  }
  return value
}

function readNumber(record: Record<string, unknown>, field: string): number {
  const value = record[field]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Expected finite number field "${field}"`)
  }
  return value
}

function readOptionalString(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`Expected string field "${field}"`)
  return value
}
