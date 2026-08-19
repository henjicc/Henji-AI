import {
  saveProjectCover,
  type ProjectCoverResultDto,
  type ProjectCoverScope,
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
  const source = record.source
  const sourceKind = record.sourceKind ?? 'image'

  if (typeof scope !== 'string' || !SCOPES.includes(scope as ProjectCoverScope)) {
    throw new Error('Expected project cover scope')
  }
  if (typeof projectId !== 'string' || projectId.length === 0) {
    throw new Error('Expected non-empty projectId')
  }
  if (typeof source !== 'string' || source.trim().length === 0) {
    throw new Error('Expected non-empty project cover source')
  }
  if (typeof sourceKind !== 'string' || !SOURCE_KINDS.includes(sourceKind as ProjectCoverSourceKind)) {
    throw new Error('Expected project cover sourceKind')
  }

  return {
    scope: scope as ProjectCoverScope,
    projectId,
    source,
    sourceKind: sourceKind as ProjectCoverSourceKind,
  }
}

export function registerProjectCoversIpc(): void {
  registerIpcHandler<SaveProjectCoverPayloadDto, ProjectCoverResultDto>(
    'projectCovers:save',
    parseSaveCoverPayload,
    (payload) => saveProjectCover(payload),
  )
}
