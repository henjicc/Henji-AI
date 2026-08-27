import type { GenerationRequestPreprocessor } from '../../generation/core'
import {
  preprocessWithProviderStrategy,
  type ProviderPreprocessInput,
  type ProviderPreprocessStrategy,
} from '../preprocess-core'

export function createGenerationPreprocessor(
  strategy: ProviderPreprocessStrategy
): GenerationRequestPreprocessor {
  return async (input) => await preprocessWithProviderStrategy({
    providerId: input.providerId,
    route: input.route,
    body: input.body,
    runtime: input.runtime,
    params: input.params,
    constraints: input.model.runtimeConstraints,
    requestId: input.requestId,
    signal: input.signal,
  }, strategy)
}

export async function preprocessProviderInput(
  strategy: ProviderPreprocessStrategy,
  input: ProviderPreprocessInput
): Promise<import('../../types/runtime').JsonValue> {
  return await preprocessWithProviderStrategy(input, strategy)
}
