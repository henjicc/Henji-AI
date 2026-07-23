import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

import type { ModelStepInput } from '../../../../../src/core/llm/modelStep'
import { resolveOpenAiCompatibleEndpoint, resolvePpioChatEndpoint } from '../streaming'

function stripChatCompletions(endpoint: string): string {
  return endpoint.replace(/\/chat\/completions\/?$/, '')
}

export function resolveModelStepBaseUrl(input: Pick<ModelStepInput, 'providerId' | 'adapter' | 'baseUrl'>): string {
  const normalizedInput = {
    ...input,
    baseUrl: input.baseUrl ? stripChatCompletions(input.baseUrl.replace(/\/+$/, '')) : undefined,
  }
  const endpoint = input.providerId.trim().toLowerCase() === 'ppio'
    ? resolvePpioChatEndpoint(normalizedInput.baseUrl)
    : resolveOpenAiCompatibleEndpoint({
        providerId: normalizedInput.providerId,
        modelId: 'placeholder',
        adapter: normalizedInput.adapter,
        baseUrl: normalizedInput.baseUrl,
        messages: [],
      })
  return stripChatCompletions(endpoint)
}

export function createModelStepLanguageModel(input: ModelStepInput, apiKey: string): LanguageModel {
  const adapter = input.adapter?.trim().toLowerCase()
  const reasoning = input.reasoning
  const provider = createOpenAICompatible({
    name: 'openai-compatible',
    apiKey,
    baseURL: resolveModelStepBaseUrl(input),
    includeUsage: input.capabilities.usage,
    supportsStructuredOutputs: usesNativeJsonSchema(input),
    transformRequestBody: adapter === 'deepseek' && input.capabilities.reasoning && reasoning
      ? body => applyModelStepProviderNativeOptions(body, reasoning.enabled)
      : undefined,
  })
  return provider.chatModel(input.modelId)
}

export function usesNativeJsonSchema(input: Pick<ModelStepInput, 'capabilities'>): boolean {
  return input.capabilities.structuredOutputMode === 'schema'
}

export function applyModelStepProviderNativeOptions(
  body: Record<string, unknown>,
  reasoningEnabled: boolean
): Record<string, unknown> {
  return { ...body, reasoning: reasoningEnabled }
}
