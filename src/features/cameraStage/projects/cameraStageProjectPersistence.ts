import { deleteCameraStageProjectRecord, getCameraStageProjectRecord, upsertCameraStageProjectRecord } from '@/commands/cameraStageProjects'
import type { CameraStageProjectPlatformWrite } from '@/platform/contracts/cameraStageProjects'
import { deserializeScene, isCurrentCameraStageScene, type StageSceneRuntimeSnapshot } from '../domain/sceneSerialization'

export interface CameraStageProjectSnapshot extends StageSceneRuntimeSnapshot {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

const tails = new Map<string, Promise<void>>()
const deleted = new Set<string>()

async function enqueue(projectId: string, mutation: () => Promise<void>): Promise<void> {
  const previous = tails.get(projectId) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(mutation)
  tails.set(projectId, current)
  try { await current } finally { if (tails.get(projectId) === current) tails.delete(projectId) }
}

export async function readProjectSnapshot(projectId: string): Promise<CameraStageProjectSnapshot | null> {
  if (deleted.has(projectId)) return null
  const record = await getCameraStageProjectRecord(projectId)
  if (!record || !isCurrentCameraStageScene(record.sceneJson)) return null
  return { ...deserializeScene(record.sceneJson), id: record.id, name: record.name, createdAt: record.createdAt, updatedAt: record.updatedAt }
}

export async function writeCameraStageProject(record: CameraStageProjectPlatformWrite): Promise<void> {
  await enqueue(record.id, async () => {
    if (deleted.has(record.id)) throw new Error('PROJECT_DELETED:工程已经删除，不能再次保存')
    await upsertCameraStageProjectRecord(record)
  })
}

export async function removeCameraStageProject(projectId: string): Promise<void> {
  await enqueue(projectId, async () => {
    await deleteCameraStageProjectRecord(projectId)
    deleted.add(projectId)
  })
}
