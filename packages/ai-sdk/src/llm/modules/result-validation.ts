import { AiRuntimeError } from '../../runtime/AiRuntimeError'
import { normalizeCapabilityStableId } from '../../capabilities/validation'
import type { DiscoveredModelItem } from '../discovery'
import type { LlmModuleOutput, LlmModuleStreamEvent } from './types'

export function validateLlmModuleOutput(output: LlmModuleOutput, moduleId: string): LlmModuleOutput {
  if (!output || typeof output.output !== 'string' || typeof output.reasoningOutput !== 'string') {
    throw new AiRuntimeError(
      'llm_module_output_invalid',
      `LLM module "${moduleId}" must return string output and reasoningOutput`
    )
  }
  if (output.finishReason !== null && typeof output.finishReason !== 'string') {
    throw new AiRuntimeError(
      'llm_module_output_invalid',
      `LLM module "${moduleId}" finishReason must be string or null`
    )
  }
  if (output.usage !== null) validateUsage(output.usage, moduleId)
  if (output.providerMetadata !== undefined && (
    typeof output.providerMetadata !== 'object' || output.providerMetadata === null ||
    Array.isArray(output.providerMetadata)
  )) {
    throw new AiRuntimeError(
      'llm_module_output_invalid',
      `LLM module "${moduleId}" providerMetadata must be an object when provided`
    )
  }
  return output
}

export function validateLlmModuleStreamEvent(event: LlmModuleStreamEvent, moduleId: string): void {
  if (!['Token', 'ReasoningToken'].includes(event?.type) || typeof event?.data !== 'string') {
    throw new AiRuntimeError(
      'llm_module_event_invalid',
      `LLM module "${moduleId}" may emit only Token/ReasoningToken events with string data; ` +
      'Usage/Finish/Done/Error are owned by the client'
    )
  }
}

export function validateDiscoveredModels(
  models: readonly DiscoveredModelItem[],
  moduleId: string
): readonly DiscoveredModelItem[] {
  if (!Array.isArray(models)) {
    throw new AiRuntimeError('llm_discovery_invalid', `LLM module "${moduleId}" discover() must return an array`)
  }
  const seen = new Set<string>()
  return Object.freeze(models.map((model, index) => {
    const modelId = normalizeCapabilityStableId(
      model?.modelId,
      'llm_discovery_invalid',
      `LLM module "${moduleId}" discovered model[${index}].modelId`
    )
    if (seen.has(modelId)) {
      throw new AiRuntimeError(
        'llm_discovery_invalid',
        `LLM module "${moduleId}" discovered duplicate modelId: ${modelId}`
      )
    }
    seen.add(modelId)
    if (typeof model.displayName !== 'string' || !model.displayName.trim()) {
      throw new AiRuntimeError(
        'llm_discovery_invalid',
        `LLM module "${moduleId}" discovered model "${modelId}" with blank displayName`
      )
    }
    validateDiscoveryLimit(model.contextWindow, moduleId, modelId, 'contextWindow')
    validateDiscoveryLimit(model.maxOutputTokens, moduleId, modelId, 'maxOutputTokens')
    return Object.freeze({ ...model, modelId, displayName: model.displayName.trim() })
  }))
}

function validateUsage(usage: NonNullable<LlmModuleOutput['usage']>, moduleId: string): void {
  for (const [key, value] of Object.entries(usage)) {
    if (value !== null && (!Number.isInteger(value) || value < 0)) {
      throw new AiRuntimeError(
        'llm_module_output_invalid',
        `LLM module "${moduleId}" usage.${key} must be null or a non-negative integer`
      )
    }
  }
}

function validateDiscoveryLimit(
  value: number | null,
  moduleId: string,
  modelId: string,
  label: string
): void {
  if (value !== null && (!Number.isInteger(value) || value <= 0)) {
    throw new AiRuntimeError(
      'llm_discovery_invalid',
      `LLM module "${moduleId}" discovered model "${modelId}" ${label} must be null or a positive integer`
    )
  }
}
