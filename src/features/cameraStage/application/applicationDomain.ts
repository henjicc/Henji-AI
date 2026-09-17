import type { ApplicationDomainModule } from '@/features/application-control/domainModule'
import { createCameraStageReflectionRegistrations } from './cameraStageReflection'
import { CAMERA_STAGE_MUTATION_ENTITY_TYPES, CameraStageMutationExecutor, CameraStageMotionOperationExecutor, type CameraStageControlExecutorDependencies } from './cameraStageControlExecutors'
import { CameraStagePlacementOperationExecutor } from './cameraStagePlacementExecutor'
import { CameraStageStateKeyframeCollectionExecutor } from './cameraStageStateKeyframeCollectionExecutor'
import { registerCameraStageCapabilityHandlers } from './registerCameraStageCapabilityHandlers'

let dependencies: CameraStageControlExecutorDependencies = { readRevision: () => 0, bumpRevision: () => undefined }
export function configureCameraStageControlDependencies(value: CameraStageControlExecutorDependencies): void { dependencies = value }

export const cameraStageApplicationDomain: ApplicationDomainModule = {
  id: 'cameraStage',
  entities: () => createCameraStageReflectionRegistrations(() => dependencies.readRevision()),
  registerExecutors(engine) {
    const current = { readRevision: () => dependencies.readRevision(), bumpRevision: () => dependencies.bumpRevision() }
    for (const entityType of CAMERA_STAGE_MUTATION_ENTITY_TYPES) engine.registerMutationExecutor(new CameraStageMutationExecutor(entityType, current))
    engine.registerOperationExecutor(new CameraStageMotionOperationExecutor(current))
    engine.registerOperationExecutor(new CameraStagePlacementOperationExecutor(current))
    engine.registerCollectionExecutor(new CameraStageStateKeyframeCollectionExecutor(current))
  },
  registerCapabilities(registrar) {
    registerCameraStageCapabilityHandlers(registrar)
  },
}
