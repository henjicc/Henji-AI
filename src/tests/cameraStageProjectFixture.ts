import { afterEach, beforeEach } from 'vitest'
import { registerCameraStageProjectInstance, resetCameraStageProjectInstancesForTests } from '@/features/cameraStage/application/cameraStageProjectRuntime'
import { attachCameraStageStore } from '@/features/cameraStage/store/cameraStageStore'
import type { StageSceneRuntimeSnapshot } from '@/features/cameraStage/domain/sceneSerialization'

beforeEach(resetCameraStageProjectInstancesForTests)
afterEach(resetCameraStageProjectInstancesForTests)

export function loadCameraStageTestProject(snapshot: StageSceneRuntimeSnapshot, project: { id: string; name: string }): void {
  const instance = registerCameraStageProjectInstance({ ...snapshot, ...project, createdAt: 1, updatedAt: 1 })
  attachCameraStageStore(instance.store)
}
