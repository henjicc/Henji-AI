import { extractAudioSamples } from '../services/audio/ops'
import type { ExtractAudioSamplesResultDto } from '../services/audio/types'
import { parseRecord, parseStringField, parseVoid, registerIpcHandler } from './registry'
import { createAudioEditProject } from '../services/audio-edit/media'
import {
  getAudioEditProject,
  listAudioEditProjects,
  requireAudioEditProject,
  saveAudioEditProject,
} from '../services/audio-edit/project-store'
import { listAudioEditAsrModels, transcribeAudioEditProject } from '../services/audio-edit/asr'
import { exportAudioEditProject } from '../services/audio-edit/export'
import { listAudioEditProcessors } from '../services/audio-edit/processors'
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
      if (JSON.stringify(project.source) !== JSON.stringify(current.source)) {
        throw new Error('IMMUTABLE_SOURCE：工程源媒体不能通过编辑接口修改。')
      }
      return saveAudioEditProject(project)
    },
  )
  registerIpcHandler('audioEdit:asr:list', parseVoid, () => listAudioEditAsrModels())
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
  const project = record.project
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    throw new Error('Expected project object')
  }
  const candidate = project as Partial<AudioEditProjectDocument>
  if (typeof candidate.id !== 'string' || !candidate.id || typeof candidate.name !== 'string'
    || typeof candidate.revision !== 'number' || !candidate.source
    || !Array.isArray(candidate.transcript) || !Array.isArray(candidate.suggestions)) {
    throw new Error('Invalid audio edit project document')
  }
  return candidate as AudioEditProjectDocument
}

function parseTranscription(input: unknown): AudioEditTranscriptionRequest {
  const record = parseRecord(input)
  return {
    projectId: readString(record, 'projectId'),
    modelId: readOptionalString(record, 'modelId'),
    language: readOptionalString(record, 'language'),
  }
}

function parseExport(input: unknown): AudioEditExportRequest {
  const record = parseRecord(input)
  return {
    projectId: readString(record, 'projectId'),
    audioTargetPath: readString(record, 'audioTargetPath'),
    subtitleTargetPath: readOptionalString(record, 'subtitleTargetPath'),
  }
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
