import { AiRuntimeError } from '../../runtime/AiRuntimeError'
import { normalizeCapabilityStableId } from '../../capabilities/validation'
import type { LlmCapabilities } from '../types'
import type { LlmModuleDescriptor, LlmModuleExecutionMode } from './types'

const CAPABILITY_BOOLEAN_KEYS = [
  'text', 'image', 'video', 'audio', 'streaming', 'toolCall', 'parallelTools',
  'jsonOutput', 'reasoning', 'sampling', 'usage',
] as const satisfies readonly (keyof LlmCapabilities)[]

const EXECUTION_MODES = new Set<LlmModuleExecutionMode>(['request-response', 'event-stream'])

export function validateLlmModuleDescriptor(descriptor: LlmModuleDescriptor): void {
  normalizeCapabilityStableId(descriptor.id, 'invalid_llm_module_id', 'LLM module id')
  normalizeCapabilityStableId(descriptor.source?.kind, 'invalid_llm_module_source', 'LLM module source kind')
  normalizeCapabilityStableId(
    descriptor.source?.namespace,
    'invalid_llm_module_source',
    'LLM module source namespace'
  )
  normalizeCapabilityStableId(descriptor.providerId, 'invalid_llm_provider_id', 'LLM provider id')
  normalizeCapabilityStableId(descriptor.modelId, 'invalid_llm_model_id', 'LLM model id')
  if (descriptor.displayName !== undefined && !descriptor.displayName.trim()) {
    throw new AiRuntimeError('invalid_llm_module_descriptor', 'LLM module displayName must not be blank')
  }
  validateCapabilities(descriptor.capabilities)
  if (!Array.isArray(descriptor.executionModes) || descriptor.executionModes.length === 0) {
    throw new AiRuntimeError(
      'invalid_llm_module_descriptor',
      'LLM module executionModes must contain request-response and/or event-stream'
    )
  }
  validateUnique(descriptor.executionModes, 'execution mode', (mode) => {
    if (!EXECUTION_MODES.has(mode)) {
      throw new AiRuntimeError(
        'invalid_llm_module_descriptor',
        `Unsupported LLM module execution mode: ${mode}. Available modes: request-response, event-stream`
      )
    }
  })
  validateUnique(descriptor.tags ?? [], 'tag', (tag) => {
    normalizeCapabilityStableId(tag, 'invalid_llm_module_descriptor', 'LLM module tag')
  })
  if (descriptor.executionModes.includes('event-stream') && !descriptor.capabilities.streaming) {
    throw new AiRuntimeError(
      'invalid_llm_module_descriptor',
      `LLM module "${descriptor.id}" declares event-stream but capabilities.streaming is false`
    )
  }
}

export function snapshotLlmModuleDescriptor(descriptor: LlmModuleDescriptor): LlmModuleDescriptor {
  validateLlmModuleDescriptor(descriptor)
  return Object.freeze({
    ...descriptor,
    source: Object.freeze({ ...descriptor.source }),
    capabilities: Object.freeze({ ...descriptor.capabilities }),
    executionModes: Object.freeze([...descriptor.executionModes]),
    tags: descriptor.tags ? Object.freeze([...descriptor.tags]) : undefined,
  })
}

export function defineLlmModuleDescriptor(descriptor: LlmModuleDescriptor): LlmModuleDescriptor {
  return snapshotLlmModuleDescriptor(descriptor)
}

export function llmModuleCoordinate(descriptor: LlmModuleDescriptor): string {
  return `${descriptor.providerId}\u0000${descriptor.modelId}`
}

export function describeLlmModuleCoordinate(descriptor: LlmModuleDescriptor): string {
  return `${descriptor.providerId}/${descriptor.modelId}`
}

export function describeLlmModuleSource(descriptor: LlmModuleDescriptor): string {
  return `${descriptor.source.kind} source "${descriptor.source.namespace}"`
}

function validateCapabilities(capabilities: LlmCapabilities | undefined): void {
  if (!capabilities || typeof capabilities !== 'object') {
    throw new AiRuntimeError('invalid_llm_module_descriptor', 'LLM module capabilities are required')
  }
  for (const key of CAPABILITY_BOOLEAN_KEYS) {
    if (typeof capabilities[key] !== 'boolean') {
      throw new AiRuntimeError(
        'invalid_llm_module_descriptor',
        `LLM module capabilities.${key} must be boolean`
      )
    }
  }
  if (!['none', 'json', 'schema'].includes(capabilities.structuredOutputMode)) {
    throw new AiRuntimeError(
      'invalid_llm_module_descriptor',
      'LLM module capabilities.structuredOutputMode must be none, json, or schema'
    )
  }
  if (capabilities.jsonOutput !== (capabilities.structuredOutputMode !== 'none')) {
    throw new AiRuntimeError(
      'invalid_llm_module_descriptor',
      'LLM module capabilities.jsonOutput must match structuredOutputMode'
    )
  }
  if (capabilities.parallelTools && !capabilities.toolCall) {
    throw new AiRuntimeError(
      'invalid_llm_module_descriptor',
      'LLM module capabilities.parallelTools requires toolCall'
    )
  }
  validateNullablePositiveInteger(capabilities.contextWindow, 'contextWindow')
  validateNullablePositiveInteger(capabilities.maxOutputTokens, 'maxOutputTokens')
}

function validateNullablePositiveInteger(value: number | null, label: string): void {
  if (value !== null && (!Number.isInteger(value) || value <= 0)) {
    throw new AiRuntimeError(
      'invalid_llm_module_descriptor',
      `LLM module capabilities.${label} must be null or a positive integer`
    )
  }
}

function validateUnique<T extends string>(
  values: readonly T[],
  label: string,
  validate: (value: T) => void
): void {
  const seen = new Set<T>()
  for (const value of values) {
    validate(value)
    if (seen.has(value)) {
      throw new AiRuntimeError(
        'invalid_llm_module_descriptor',
        `LLM module ${label} is duplicated: ${value}`
      )
    }
    seen.add(value)
  }
}
