import {
  deleteStoryboardProject,
  getStoryboardProject,
  listStoryboardProjectSummaries,
  renameStoryboardProject,
  updateStoryboardProjectViewport,
  upsertStoryboardProject,
  type StoryboardProjectRecordDto,
  type StoryboardProjectSummaryDto,
  type StoryboardProjectWriteDto,
} from '../services/storyboard-projects'
import { parseRecord, parseStringField, parseVoid, registerIpcHandler } from './registry'
import { applicationPersistenceCorrelationSchema, type ApplicationPersistenceCorrelation } from '../../../src/core/application-control/persistenceCorrelation'
import { getDb } from '../services/db'
import { AgentOperationStore } from '../services/agent-runtime/persistence/operation-store'
import { digestJson } from '../services/agent-runtime/tools/security'

type CorrelatedProjectWrite = StoryboardProjectWriteDto & { operationCorrelation?: ApplicationPersistenceCorrelation }

interface ProjectIdPayload {
  projectId: string
  operationCorrelation?: ApplicationPersistenceCorrelation
}

interface ViewportPayload extends ProjectIdPayload {
  viewportJson: string
}

interface RenamePayload extends ProjectIdPayload {
  name: string
  updatedAt: number
}

function parseProjectRecord(input: unknown): CorrelatedProjectWrite {
  const record = parseRecord(input)
  const id = record.id
  const name = record.name
  const createdAt = Number(record.createdAt)
  const updatedAt = Number(record.updatedAt)
  const nodeCount = Number(record.nodeCount)
  const nodesJson = record.nodesJson
  const edgesJson = record.edgesJson
  const viewportJson = record.viewportJson
  const historyJson = record.historyJson

  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Expected non-empty storyboard project id')
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('Expected non-empty storyboard project name')
  }
  if (typeof nodesJson !== 'string') {
    throw new Error('Expected storyboard project nodesJson string')
  }
  if (typeof edgesJson !== 'string') {
    throw new Error('Expected storyboard project edgesJson string')
  }
  if (typeof viewportJson !== 'string') {
    throw new Error('Expected storyboard project viewportJson string')
  }
  if (typeof historyJson !== 'string') {
    throw new Error('Expected storyboard project historyJson string')
  }

  return {
    id,
    name: name.trim(),
    createdAt,
    updatedAt,
    nodeCount,
    nodesJson,
    edgesJson,
    viewportJson,
    historyJson,
    ...(record.operationCorrelation !== undefined ? {
      operationCorrelation: applicationPersistenceCorrelationSchema.parse(record.operationCorrelation),
    } : {}),
  }
}

function parseProjectIdPayload(input: unknown): ProjectIdPayload {
  const record = parseRecord(input)
  return { projectId: parseStringField(input, 'projectId'),
    ...(record.operationCorrelation !== undefined ? { operationCorrelation: applicationPersistenceCorrelationSchema.parse(record.operationCorrelation) } : {}) }
}

function parseViewportPayload(input: unknown): ViewportPayload {
  const record = parseRecord(input)
  const projectId = record.projectId
  const viewportJson = record.viewportJson
  if (typeof projectId !== 'string' || projectId.length === 0) {
    throw new Error('Expected non-empty projectId')
  }
  if (typeof viewportJson !== 'string') {
    throw new Error('Expected viewportJson string')
  }
  return { projectId, viewportJson }
}

function parseRenamePayload(input: unknown): RenamePayload {
  const record = parseRecord(input)
  const projectId = record.projectId
  const name = record.name
  const updatedAt = Number(record.updatedAt)
  if (typeof projectId !== 'string' || projectId.length === 0) {
    throw new Error('Expected non-empty projectId')
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('Expected non-empty project name')
  }
  return { ...parseProjectIdPayload(input), projectId, name: name.trim(), updatedAt }
}

function requireProjectCorrelation(projectId: string, correlation: ApplicationPersistenceCorrelation): void {
  if (correlation.targets.some((ref) => !(
    (ref.kind === 'canvas.project' && ref.id === projectId)
    || (['canvas.node', 'canvas.edge'].includes(ref.kind) && ref.id.startsWith(`${projectId}:`))
  ))) throw new Error('[OPERATION_PERSISTENCE_TARGET_INVALID] 保存关联必须属于原画布工程')
}

export function registerStoryboardProjectsIpc(): void {
  registerIpcHandler<void, StoryboardProjectSummaryDto[]>('storyboardProjects:list', parseVoid, () => listStoryboardProjectSummaries())
  registerIpcHandler<ProjectIdPayload, StoryboardProjectRecordDto | null>('storyboardProjects:get', parseProjectIdPayload, ({ projectId }) => {
    return getStoryboardProject(projectId)
  })
  registerIpcHandler<CorrelatedProjectWrite, void>('storyboardProjects:upsert', parseProjectRecord, (input, event) => {
    const { operationCorrelation, ...record } = input
    if (!operationCorrelation) { upsertStoryboardProject(record); return }
    const database = getDb()
    const operations = new AgentOperationStore(database)
    requireProjectCorrelation(record.id, operationCorrelation)
    operations.commitPersistence(operationCorrelation, { kind: 'canvas.project', id: record.id }, event.sender.id,
      digestJson(record), () => upsertStoryboardProject(record))
  })
  registerIpcHandler<ViewportPayload, void>('storyboardProjects:updateViewport', parseViewportPayload, ({ projectId, viewportJson }) => {
    updateStoryboardProjectViewport(projectId, viewportJson)
  })
  registerIpcHandler<RenamePayload, void>('storyboardProjects:rename', parseRenamePayload, ({ projectId, name, updatedAt, operationCorrelation }, event) => {
    if (!operationCorrelation) { renameStoryboardProject(projectId, name, updatedAt); return }
    requireProjectCorrelation(projectId, operationCorrelation)
    new AgentOperationStore(getDb()).commitPersistence(operationCorrelation, { kind: 'canvas.project', id: projectId }, event.sender.id,
      digestJson({ projectId, name, updatedAt }), () => renameStoryboardProject(projectId, name, updatedAt))
  })
  registerIpcHandler<ProjectIdPayload, void>('storyboardProjects:delete', parseProjectIdPayload, async ({ projectId, operationCorrelation }, event) => {
    if (!operationCorrelation) { await deleteStoryboardProject(projectId); return }
    requireProjectCorrelation(projectId, operationCorrelation)
    const operations = new AgentOperationStore(getDb())
    operations.assertPersistenceOwner(operationCorrelation.operationId, event.sender.id)
    await deleteStoryboardProject(projectId, (write) => operations.commitPersistence(operationCorrelation,
      { kind: 'canvas.project', id: projectId }, event.sender.id, digestJson({ projectId, deleted: true }), write))
  })
}
