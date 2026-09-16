import { CanvasPersistenceError, CanvasTransactionRolledBackError } from './canvasPersistenceService'
import { CanvasApplicationError } from './canvasApplicationService'
import { MultiLayerDocumentNodeApplicationError } from './multiLayerDocumentNodeApplicationService'
import { ApplicationTransactionFailure } from '@/core/application-control/execution/transactionFailure'
import type { ApplicationDomainModule } from '@/features/application-control/domainModule'
import { createCanvasReflectionRegistrations, CANVAS_ENTITY_TYPES } from './canvasReflection'
import { createStoryboardReflectionRegistrations } from './storyboardReflection'
import { CanvasNodeMutationExecutor } from './canvasMutationExecutor'
import { CanvasProjectMutationExecutor } from './canvasProjectMutationExecutor'
import { CanvasCollectionExecutor, type CanvasCollectionDependencies } from './canvasCollectionExecutor'
import { registerCanvasCapabilityHandlers } from './registerCanvasCapabilityHandlers'
import { registerStoryboardCapabilityHandlers } from './registerStoryboardCapabilityHandlers'

let dependencies: CanvasCollectionDependencies = { readRevision: () => 0, bumpRevision: () => undefined }
export function configureCanvasCollectionDependencies(value: CanvasCollectionDependencies): void { dependencies = value }

export const canvasApplicationDomain: ApplicationDomainModule = {
  id: 'canvas',
  entities: () => [...createCanvasReflectionRegistrations(), ...createStoryboardReflectionRegistrations()],
  registerExecutors(engine) {
    engine.registerMutationExecutor(new CanvasNodeMutationExecutor())
    engine.registerMutationExecutor(new CanvasProjectMutationExecutor())
    for (const entityType of [CANVAS_ENTITY_TYPES.node, CANVAS_ENTITY_TYPES.edge]) engine.registerCollectionExecutor(new CanvasCollectionExecutor(entityType, {
      readRevision: () => dependencies.readRevision(), bumpRevision: () => dependencies.bumpRevision(),
    }))
  },
  registerCapabilities(registrar) {
    registerCanvasCapabilityHandlers(registrar)
    registerStoryboardCapabilityHandlers(registrar)
  },
  failure(error, normalize) {
  if (error instanceof CanvasTransactionRolledBackError) {
    const failure = normalize(error.cause)
    if (!failure.ok) return { ...failure, error: { ...failure.error, details: { execution: { rolledBack: true } } } }
  }
  if (error instanceof CanvasPersistenceError && error.transactionFacts) return normalize(new ApplicationTransactionFailure(error.transactionFacts))
  if (error instanceof CanvasApplicationError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        recoverable: error.recoverable,
        details: error.details,
      },
    }
  }
  if (error instanceof MultiLayerDocumentNodeApplicationError) {
    const code = error.code === 'INVALID_INPUT' || error.code === 'UNSUPPORTED_EXPORT_TARGET'
      ? 'INVALID_INPUT'
      : error.code === 'DOCUMENT_NOT_FOUND'
        ? 'NOT_FOUND'
        : error.code === 'DOCUMENT_CONFLICT'
          ? 'CONFLICT'
          : error.code === 'CANCELLED'
            ? 'ABORTED'
            : error.code === 'MIGRATION_REQUIRED' || error.code === 'INVALID_NODE_STATE'
              ? 'CAPABILITY_NOT_READY'
              : 'CAPABILITY_REJECTED'
    return {
      ok: false,
      error: {
        code,
        message: error.message,
        recoverable: error.recoverable,
      },
    }
  }
    return undefined
  },
}
