import {
  createCanvasProject,
  deleteCanvasProject,
  getCanvasProject,
  listCanvasProjects,
  renameCanvasProject,
  saveCanvasProjectSnapshot,
  type CanvasProjectRecordDto,
  type CanvasProjectSnapshotDto,
  type CanvasProjectSummaryDto,
} from '../services/canvas-projects'
import { parseRecord, parseStringField, parseVoid, registerIpcHandler } from './registry'

interface CreateCanvasProjectPayload {
  id: string
  name: string
  snapshot: CanvasProjectSnapshotDto
}

interface ProjectIdPayload {
  projectId: string
}

interface RenameProjectPayload extends ProjectIdPayload {
  name: string
}

interface SaveSnapshotPayload extends ProjectIdPayload {
  snapshot: CanvasProjectSnapshotDto
}

function parseSnapshot(input: unknown): CanvasProjectSnapshotDto {
  const record = parseRecord(input)
  const nodes = record.nodes
  const edges = record.edges
  const viewport = record.viewport

  if (!Array.isArray(nodes)) {
    throw new Error('Expected canvas project snapshot nodes array')
  }
  if (!Array.isArray(edges)) {
    throw new Error('Expected canvas project snapshot edges array')
  }
  if (viewport === undefined) {
    throw new Error('Expected canvas project snapshot viewport')
  }

  return { nodes, edges, viewport }
}

function parseCreatePayload(input: unknown): CreateCanvasProjectPayload {
  const record = parseRecord(input)
  const id = record.id
  const name = record.name
  const snapshot = record.snapshot

  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Expected non-empty canvas project id')
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('Expected non-empty canvas project name')
  }

  return {
    id,
    name: name.trim(),
    snapshot: parseSnapshot(snapshot),
  }
}

function parseProjectIdPayload(input: unknown): ProjectIdPayload {
  return { projectId: parseStringField(input, 'projectId') }
}

function parseRenamePayload(input: unknown): RenameProjectPayload {
  const record = parseRecord(input)
  const projectId = record.projectId
  const name = record.name

  if (typeof projectId !== 'string' || projectId.length === 0) {
    throw new Error('Expected non-empty projectId')
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('Expected non-empty project name')
  }

  return { projectId, name: name.trim() }
}

function parseSaveSnapshotPayload(input: unknown): SaveSnapshotPayload {
  const record = parseRecord(input)
  const projectId = record.projectId
  const snapshot = record.snapshot

  if (typeof projectId !== 'string' || projectId.length === 0) {
    throw new Error('Expected non-empty projectId')
  }

  return { projectId, snapshot: parseSnapshot(snapshot) }
}

export function registerCanvasProjectsIpc(): void {
  registerIpcHandler<void, CanvasProjectSummaryDto[]>('canvasProjects:list', parseVoid, () => listCanvasProjects())
  registerIpcHandler<CreateCanvasProjectPayload, CanvasProjectRecordDto>('canvasProjects:create', parseCreatePayload, ({ id, name, snapshot }) => {
    return createCanvasProject(id, name, snapshot)
  })
  registerIpcHandler<ProjectIdPayload, CanvasProjectRecordDto | null>('canvasProjects:get', parseProjectIdPayload, ({ projectId }) => {
    return getCanvasProject(projectId)
  })
  registerIpcHandler<RenameProjectPayload, void>('canvasProjects:rename', parseRenamePayload, ({ projectId, name }) => {
    renameCanvasProject(projectId, name)
  })
  registerIpcHandler<SaveSnapshotPayload, void>('canvasProjects:saveSnapshot', parseSaveSnapshotPayload, ({ projectId, snapshot }) => {
    saveCanvasProjectSnapshot(projectId, snapshot)
  })
  registerIpcHandler<ProjectIdPayload, void>('canvasProjects:delete', parseProjectIdPayload, ({ projectId }) => {
    deleteCanvasProject(projectId)
  })
}
