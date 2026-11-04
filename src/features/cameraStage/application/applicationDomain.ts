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
export { configureCameraStageControlDependencies } from './cameraStageControlDependencies'

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
    registerCurrentDocumentProvider('cameraStage', host => host.activeWorkspace === 'tools' && host.activeToolId === 'cameraStage' && useCameraStageSessionStore.getState().appView === 'editor' ? useCameraStageSessionStore.getState().lastDocumentId ?? undefined : undefined)
    registerCameraStageCapabilityHandlers(registrar)
  },
}
