import {
  saveProjectCover,
  type ProjectCoverResultDto,
  type ProjectCoverScope,
  type ProjectCoverSourceDto,
  type ProjectCoverSourceKind,
  type SaveProjectCoverPayloadDto,
} from '../services/project-covers'
import { parseRecord, registerIpcHandler } from './registry'

const SCOPES: ProjectCoverScope[] = ['canvas', 'camera-stage']
const SOURCE_KINDS: ProjectCoverSourceKind[] = ['image', 'video']

function parseSaveCoverPayload(input: unknown): SaveProjectCoverPayloadDto {
  const record = parseRecord(input)
  const scope = record.scope
  const projectId = record.projectId
  const rawSources = record.sources

  if (typeof scope !== 'string' || !SCOPES.includes(scope as ProjectCoverScope)) {
    throw new Error('Expected project cover scope')
  }
  if (typeof projectId !== 'string' || projectId.length === 0) {
    throw new Error('Expected non-empty projectId')
  }
  if (!Array.isArray(rawSources) || rawSources.length < 1 || rawSources.length > 4) {
    throw new Error('Expected 1 to 4 project cover sources')
  }

  const sources = rawSources.map((item): ProjectCoverSourceDto => {
    const sourceRecord = parseRecord(item)
    const source = sourceRecord.source
    const sourceKind = sourceRecord.sourceKind ?? 'image'
    if (typeof source !== 'string' || source.trim().length === 0) {
      throw new Error('Expected non-empty project cover source')
    }
    if (typeof sourceKind !== 'string' || !SOURCE_KINDS.includes(sourceKind as ProjectCoverSourceKind)) {
      throw new Error('Expected project cover sourceKind')
    }
    return { source, sourceKind: sourceKind as ProjectCoverSourceKind }
  })

  return {
    scope: scope as ProjectCoverScope,
    projectId,
    sources,
  }
}

export function registerProjectCoversIpc(): void {
  registerIpcHandler<SaveProjectCoverPayloadDto, ProjectCoverResultDto>(
    'projectCovers:save',
    parseSaveCoverPayload,
    (payload) => saveProjectCover(payload),
  )
}
