import { registerCurrentDocumentProvider } from '@/features/documents'
import { useCameraStageSessionStore } from '../store/cameraStageSessionStore'
import '../layout/dockLayout'
import type { ApplicationDomainModule } from '@/features/application-control/domainModule'
import { createCameraStageReflectionRegistrations } from './cameraStageReflection'
import { CAMERA_STAGE_MUTATION_ENTITY_TYPES, CameraStageMutationExecutor, CameraStageMotionOperationExecutor } from './cameraStageControlExecutors'
import { CameraStagePlacementOperationExecutor } from './cameraStagePlacementExecutor'
import { CameraStageShotOperationExecutor } from './cameraStageShotExecutor'
import { CameraStageBlockingOperationExecutor, CameraStageFollowOperationExecutor } from './cameraStageBlockingExecutors'
import { CameraStageStateKeyframeCollectionExecutor } from './cameraStageStateKeyframeCollectionExecutor'
import { CameraStageCameraCutCollectionExecutor } from './cameraStageCameraCutService'
import { CameraStageCoverageOperationExecutor, CameraStageCutOperationExecutor } from './cameraStageCoverageExecutors'
import { CameraStageSetCollectionExecutor, CameraStageSetGenerateOperationExecutor } from './cameraStageSetExecutors'
import { registerCameraStageCapabilityHandlers } from './registerCameraStageCapabilityHandlers'

import { dependencies } from './cameraStageControlDependencies'

/** 只有镜头参考工具页真的显示着编辑器才算当前文档；页面切走后记录仍在，那时它只是后台持有，可以被释放。 */
export function cameraStageCurrentDocument(host: { activeWorkspace: string; activeToolId: string | null }): string | undefined {
  const editor = useCameraStageSessionStore.getState()
  return host.activeWorkspace === 'tools' && host.activeToolId === 'cameraStage' && editor.appView === 'editor' ? editor.lastDocumentId ?? undefined : undefined
}

export const cameraStageApplicationDomain: ApplicationDomainModule = {
  id: 'cameraStage',
  entities: () => createCameraStageReflectionRegistrations(() => dependencies.readRevision()),
  registerExecutors(engine) {
    const current = { readRevision: () => dependencies.readRevision(), bumpRevision: () => dependencies.bumpRevision() }
    for (const entityType of CAMERA_STAGE_MUTATION_ENTITY_TYPES) engine.registerMutationExecutor(new CameraStageMutationExecutor(entityType, current))
    engine.registerOperationExecutor(new CameraStageMotionOperationExecutor(current))
    engine.registerOperationExecutor(new CameraStagePlacementOperationExecutor(current))
    engine.registerOperationExecutor(new CameraStageShotOperationExecutor(current))
    engine.registerOperationExecutor(new CameraStageBlockingOperationExecutor(current))
    engine.registerOperationExecutor(new CameraStageFollowOperationExecutor(current))
    engine.registerOperationExecutor(new CameraStageCoverageOperationExecutor(current))
    engine.registerOperationExecutor(new CameraStageCutOperationExecutor(current))
    engine.registerCollectionExecutor(new CameraStageStateKeyframeCollectionExecutor(current))
    engine.registerCollectionExecutor(new CameraStageCameraCutCollectionExecutor(current))
    engine.registerOperationExecutor(new CameraStageSetGenerateOperationExecutor(current))
    engine.registerCollectionExecutor(new CameraStageSetCollectionExecutor(current))
  },
  registerCapabilities(registrar) {
    registerCurrentDocumentProvider('cameraStage', cameraStageCurrentDocument)
    registerCameraStageCapabilityHandlers(registrar)
  },
}
