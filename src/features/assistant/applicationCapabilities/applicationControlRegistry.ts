import {
  ApplicationControlExecutionEngine,
  ApplicationReflectionRegistry,
} from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/assistant/applicationCapabilities'

import {
  createSettingsReflectionRegistration,
  SettingsMutationExecutor,
} from '@/features/settings/application-control'
import { createCameraStageReflectionRegistrations } from '@/features/cameraStage/application/cameraStageReflection'
import {
  CAMERA_STAGE_MUTATION_ENTITY_TYPES,
  type CameraStageControlExecutorDependencies,
  CameraStageMotionOperationExecutor,
  CameraStageMutationExecutor,
} from '@/features/cameraStage/application/cameraStageControlExecutors'
import { CameraStagePlacementOperationExecutor } from '@/features/cameraStage/application/cameraStagePlacementExecutor'

let registry: ApplicationReflectionRegistry | undefined
let executionEngine: ApplicationControlExecutionEngine | undefined
let cameraStageDependencies: CameraStageControlExecutorDependencies = {
  readRevision: () => 0,
  bumpRevision: () => undefined,
}

export function configureCameraStageControlDependencies(
  dependencies: CameraStageControlExecutorDependencies,
): void {
  cameraStageDependencies = dependencies
}

export function getApplicationReflectionRegistry(): ApplicationReflectionRegistry {
  if (!registry) {
    registry = new ApplicationReflectionRegistry(APPLICATION_CAPABILITY_CATALOG_VERSION)
    registry.register(createSettingsReflectionRegistration())
    for (const registration of createCameraStageReflectionRegistrations(
      () => cameraStageDependencies.readRevision()
    )) {
      registry.register(registration)
    }
  }
  return registry
}

export function getApplicationControlExecutionEngine(): ApplicationControlExecutionEngine {
  if (!executionEngine) {
    executionEngine = new ApplicationControlExecutionEngine(getApplicationReflectionRegistry())
    executionEngine.registerMutationExecutor(new SettingsMutationExecutor())
    const dependencies: CameraStageControlExecutorDependencies = {
      readRevision: () => cameraStageDependencies.readRevision(),
      bumpRevision: () => cameraStageDependencies.bumpRevision(),
    }
    for (const entityType of CAMERA_STAGE_MUTATION_ENTITY_TYPES) {
      executionEngine.registerMutationExecutor(new CameraStageMutationExecutor(entityType, dependencies))
    }
    executionEngine.registerOperationExecutor(new CameraStageMotionOperationExecutor(dependencies))
    executionEngine.registerOperationExecutor(new CameraStagePlacementOperationExecutor(dependencies))
  }
  return executionEngine
}
