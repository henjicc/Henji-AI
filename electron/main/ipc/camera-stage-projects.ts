import {
  deleteCameraStageProject,
  getCameraStageProject,
  listCameraStageProjectSummaries,
  renameCameraStageProject,
  upsertCameraStageProject,
  type CameraStageProjectRecordDto,
  type CameraStageProjectSummaryDto,
  type CameraStageProjectWriteDto,
} from '../services/camera-stage-projects'
import { parseRecord, parseStringField, parseVoid, registerIpcHandler } from './registry'
import { applicationPersistenceCorrelationSchema, type ApplicationPersistenceCorrelation } from '../../../src/core/application-control/persistenceCorrelation'
import { getDb } from '../services/db'
import { AgentOperationStore } from '../services/agent-runtime/persistence/operation-store'
import { digestJson } from '../services/agent-runtime/tools/security'

type CorrelatedProjectWrite = CameraStageProjectWriteDto & { operationCorrelation?: ApplicationPersistenceCorrelation }

interface ProjectIdPayload {
  projectId: string
  operationCorrelation?: ApplicationPersistenceCorrelation
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
  const objectCount = Number(record.objectCount)
  const sceneJson = record.sceneJson

  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Expected non-empty camera stage project id')
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('Expected non-empty camera stage project name')
  }
  if (typeof sceneJson !== 'string') {
    throw new Error('Expected camera stage project sceneJson string')
  }

  return {
    id,
    name: name.trim(),
    createdAt,
    updatedAt,
    objectCount,
    sceneJson,
    ...(record.operationCorrelation !== undefined ? {
      operationCorrelation: applicationPersistenceCorrelationSchema.parse(record.operationCorrelation),
    } : {}),
  }
}

function parseProjectIdPayload(input: unknown): ProjectIdPayload {
  const record = parseRecord(input)
  return { projectId: parseStringField(input, 'projectId'), ...(record.operationCorrelation !== undefined
    ? { operationCorrelation: applicationPersistenceCorrelationSchema.parse(record.operationCorrelation) } : {}) }
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

function assertProjectTargets(correlation: ApplicationPersistenceCorrelation, projectId: string): void {
  if (correlation.targets.some((ref) => !ref.kind.startsWith('camera_stage.')
    || (ref.id !== projectId && !ref.id.startsWith(`${projectId}:`)))) {
    throw new Error('[OPERATION_PERSISTENCE_TARGET_INVALID] 保存关联必须属于原三维工程')
  }
}

export function registerCameraStageProjectsIpc(): void {
  registerIpcHandler<void, CameraStageProjectSummaryDto[]>(
    'cameraStageProjects:list',
    parseVoid,
    () => listCameraStageProjectSummaries(),
  )
  registerIpcHandler<ProjectIdPayload, CameraStageProjectRecordDto | null>(
    'cameraStageProjects:get',
    parseProjectIdPayload,
    ({ projectId }) => getCameraStageProject(projectId),
  )
  registerIpcHandler<CorrelatedProjectWrite, void>(
    'cameraStageProjects:upsert',
    parseProjectRecord,
    (input, event) => {
      const { operationCorrelation, ...record } = input
      if (!operationCorrelation) { upsertCameraStageProject(record); return }
      assertProjectTargets(operationCorrelation, record.id)
      new AgentOperationStore(getDb()).commitPersistence(operationCorrelation, { kind: 'camera_stage.project', id: record.id },
        event.sender.id, digestJson(record), () => upsertCameraStageProject(record))
    },
  )
  registerIpcHandler<RenamePayload, void>(
    'cameraStageProjects:rename',
    parseRenamePayload,
    ({ projectId, name, updatedAt, operationCorrelation }, event) => {
      const write = () => renameCameraStageProject(projectId, name, updatedAt)
      if (!operationCorrelation) { write(); return }
      assertProjectTargets(operationCorrelation, projectId)
      new AgentOperationStore(getDb()).commitPersistence(operationCorrelation, { kind: 'camera_stage.project', id: projectId },
        event.sender.id, digestJson({ action: 'rename', projectId, name, updatedAt }), write)
    },
  )
  registerIpcHandler<ProjectIdPayload, void>(
    'cameraStageProjects:delete',
    parseProjectIdPayload,
    async ({ projectId, operationCorrelation }, event) => {
      if (!operationCorrelation) { await deleteCameraStageProject(projectId); return }
      assertProjectTargets(operationCorrelation, projectId)
      const operations = new AgentOperationStore(getDb())
      operations.assertPersistenceOwner(operationCorrelation.operationId, event.sender.id)
      await deleteCameraStageProject(projectId, (write) => operations.commitPersistence(operationCorrelation,
        { kind: 'camera_stage.project', id: projectId }, event.sender.id, digestJson({ action: 'delete', projectId }), write))
    },
  )
}
