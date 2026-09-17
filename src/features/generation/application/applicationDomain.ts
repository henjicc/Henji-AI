import { GenerationPreparationError } from './generationPreparationService'
import type { ApplicationDomainModule } from '@/features/application-control/domainModule'
import { createGenerationReflectionRegistrations, createGenerationDraftReflectionRegistration } from './generationReflection'
import { GenerationDraftMutationExecutor } from './generationDraftMutationExecutor'
import { GenerationModelMutationExecutor } from './generationModelMutationExecutor'
import { registerGenerationCapabilityHandlers } from './registerGenerationCapabilityHandlers'
import { listGenerationHistoryCapability } from '@/core/application-control/builtinApplicationCapabilities'
import { listGenerationHistory } from './generationHistoryCapabilityService'

export const generationApplicationDomain: ApplicationDomainModule = {
  id: 'generation',
  entities: () => [...createGenerationReflectionRegistrations(), createGenerationDraftReflectionRegistration()],
  registerExecutors(engine) {
    engine.registerMutationExecutor(new GenerationDraftMutationExecutor())
    engine.registerMutationExecutor(new GenerationModelMutationExecutor())
  },
  registerCapabilities(registrar) {
    registerGenerationCapabilityHandlers(registrar)
    registrar.registerHandler(listGenerationHistoryCapability.id, input => listGenerationHistory(listGenerationHistoryCapability.inputSchema.parse(input)))
  },
  failure(error) {
  if (error instanceof GenerationPreparationError) {
    return {
      ok: false,
      error: {
        code: error.code === 'MODEL_NOT_FOUND' ? 'NOT_FOUND' : 'INVALID_INPUT',
        message: error.message,
        recoverable: true,
        details: error.details,
      },
    }
  }
    return undefined
  },
}
