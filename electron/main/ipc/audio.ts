import { isDeepStrictEqual } from 'node:util'
import { assertAudioEditLocks } from '../../../src/core/audioEdit/edits'
import { extractAudioSamples } from '../services/audio/ops'
import type { ExtractAudioSamplesResultDto } from '../services/audio/types'
import { parseRecord, parseStringField, parseVoid, registerIpcHandler } from './registry'
import { createAudioEditProject, deleteAudioEditProject, relinkAudioEditSource, verifyAudioEditSource } from '../services/audio-edit/media'
import { detectAudioEditSilence } from '../services/audio-edit/silence'
import { cancelAudioEditTask, listAudioEditTasks, runAudioEditTask } from '../services/audio-edit/task-store'
import { audioEditProjectSchema, audioEditSettingsSchema, audioEditRangeSchema, audioEditFrameRateSchema } from '../../../src/core/audioEdit/schema'
import { hasAudioEditModifications } from '../../../src/core/audioEdit/baseline'
import {
  getAudioEditProject,
  listAudioEditProjects,
  requireAudioEditProject,
  saveAudioEditProject,
} from '../services/audio-edit/project-store'
import { listAudioEditAsrModels, transcribeAudioEditProject } from '../services/audio-edit/asr'
import { exportAudioEditProject } from '../services/audio-edit/export'
import { listAudioEditProcessors, prepareAudioEditProcessedAudio } from '../services/audio-edit/processors'
import { prepareAudioEditPreviewChunk } from '../services/audio-edit/preview'
import type {
  AudioEditExportRequest,
  AudioEditProjectCreateRequest,
  AudioEditProjectDocument,
  AudioEditPreviewChunkRequest,
  AudioEditTranscriptionRequest,
} from '../../../src/core/audioEdit/types'

interface ExtractAudioSamplesPayload {
  source: string
  bucketCount: number
}

export function registerAudioIpc(): void {
  registerIpcHandler<ExtractAudioSamplesPayload, ExtractAudioSamplesResultDto>(
    'audio:extractSamples',
    parseExtractAudioSamplesPayload,
    ({ source, bucketCount }) => extractAudioSamples(source, bucketCount)
  )

  registerIpcHandler('audioEdit:projects:list', parseVoid, () => listAudioEditProjects())
  registerIpcHandler<AudioEditProjectCreateRequest, AudioEditProjectDocument>(
    'audioEdit:projects:create',
    parseCreateProject,
    createAudioEditProject,
  )
  registerIpcHandler('audioEdit:projects:get', (input) => parseStringField(input, 'projectId'), getAudioEditProject)
  registerIpcHandler<AudioEditProjectDocument, AudioEditProjectDocument>(
    'audioEdit:projects:save',
    parseProjectSave,
    (project) => {
      const current = requireAudioEditProject(project.id)
      if (!isDeepStrictEqual(project.source, current.source)) {
        throw new Error('IMMUTABLE_SOURCE：工程源媒体不能通过编辑接口修改。')
      }
      // Explicit full restoration can restore lock state; arbitrary edits remain protected.
      // Always use the host's immutable baseline, never one supplied by the caller.
      if (hasAudioEditModifications({ ...project, editBaseline: current.editBaseline })) assertAudioEditLocks(current, project)
      return saveAudioEditProject(project)
    },
  )
  registerIpcHandler('audioEdit:asr:list', parseVoid, () => listAudioEditAsrModels())
  registerIpcHandler('audioEdit:source:verify', (input) => parseStringField(input, 'projectId'), (id) => verifyAudioEditSource(requireAudioEditProject(id)))
  registerIpcHandler('audioEdit:source:relink', (input) => {
    const record = parseRecord(input)
    return { projectId: readString(record, 'projectId'), sourcePath: readString(record, 'sourcePath') }
  }, ({ projectId, sourcePath }) => relinkAudioEditSource(projectId, sourcePath))
  registerIpcHandler('audioEdit:projects:delete', (input) => parseStringField(input, 'projectId'), deleteAudioEditProject)
  registerIpcHandler('audioEdit:silence', (input) => {
    const record = parseRecord(input)
    return { projectId: readString(record, 'projectId'), settings: audioEditSettingsSchema.parse(record.settings), range: record.range === undefined ? undefined : audioEditRangeSchema.parse(record.range), requestId: readOptionalString(record, 'requestId') }
  }, detectAudioEditSilence)
  registerIpcHandler('audioEdit:tasks:list', (input) => parseStringField(input, 'projectId'), listAudioEditTasks)
  registerIpcHandler('audioEdit:tasks:cancel', (input) => parseStringField(input, 'requestId'), cancelAudioEditTask)
  registerIpcHandler('audioEdit:processing', (input) => {
    const record = parseRecord(input)
    return { projectId: readString(record, 'projectId'), requestId: readString(record, 'requestId') }
  }, ({ projectId, requestId }) => {
    const project = requireAudioEditProject(projectId)
    return runAudioEditTask(projectId, 'processing', async (signal, progress) => {
      await verifyAudioEditSource(project)
      await prepareAudioEditProcessedAudio(project, signal, progress)
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
    sourceStartFrame: readNumber(record, 'sourceStartFrame'),
    frameCount: readNumber(record, 'frameCount'),
    processing: record.processing === undefined ? undefined : readBoolean(record, 'processing'),
  }
}

function parseCreateProject(input: unknown): AudioEditProjectCreateRequest {
  const record = parseRecord(input)
  return {
    sourcePath: readString(record, 'sourcePath'),
    name: readOptionalString(record, 'name'),
    referenceScript: readOptionalString(record, 'referenceScript'),
  }
}

function parseProjectSave(input: unknown): AudioEditProjectDocument {
  const record = parseRecord(input)
  return audioEditProjectSchema.parse(record.project)
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

function parseExtractAudioSamplesPayload(input: unknown): ExtractAudioSamplesPayload {
  const record = parseRecord(input)
  return {
    source: readString(record, 'source'),
    bucketCount: readNumber(record, 'bucketCount'),
  }
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
