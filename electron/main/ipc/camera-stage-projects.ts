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

interface ProjectIdPayload {
  projectId: string
}

interface RenamePayload extends ProjectIdPayload {
  name: string
  updatedAt: number
}

function parseProjectRecord(input: unknown): CameraStageProjectWriteDto {
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
  }
}

function parseProjectIdPayload(input: unknown): ProjectIdPayload {
  return { projectId: parseStringField(input, 'projectId') }
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
  return { projectId, name: name.trim(), updatedAt }
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
  registerIpcHandler<CameraStageProjectWriteDto, void>(
    'cameraStageProjects:upsert',
    parseProjectRecord,
    (record) => {
      upsertCameraStageProject(record)
    },
  )
  registerIpcHandler<RenamePayload, void>(
    'cameraStageProjects:rename',
    parseRenamePayload,
    ({ projectId, name, updatedAt }) => {
      renameCameraStageProject(projectId, name, updatedAt)
    },
  )
  registerIpcHandler<ProjectIdPayload, void>(
    'cameraStageProjects:delete',
    parseProjectIdPayload,
    async ({ projectId }) => {
      await deleteCameraStageProject(projectId)
    },
  )
}
