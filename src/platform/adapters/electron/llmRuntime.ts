import type { LlmRuntimePlatform } from '@/platform/contracts/llmRuntime'

const DOMAIN = 'llmRuntime'

function getNativeLlm(): NonNullable<typeof window.henjiNative>['llm'] {
  const native = window.henjiNative
  if (!native?.llm) {
    throw new Error(`[platform:${DOMAIN}] henjiNative.llm is not available`)
  }
  return native.llm
}

export function createElectronLlmRuntime(): LlmRuntimePlatform {
  return {
    setProviderApiKey: async (providerId, apiKey) => {
      await getNativeLlm().setProviderApiKey(providerId, apiKey)
    },
    removeProviderApiKey: async (providerId) => {
      await getNativeLlm().removeProviderApiKey(providerId)
    },
    getProviderApiKey: async (providerId) => {
      return await getNativeLlm().getProviderApiKey(providerId)
    },
    getProviderKeyStatus: async (providerIds) => {
      return await getNativeLlm().getProviderKeyStatus(providerIds)
    },
    chatStream: async (request, onEvent) => {
      await getNativeLlm().chatStream(request, onEvent)
    },
    cancelTask: async (taskId) => {
      await getNativeLlm().cancelTask(taskId)
    },
  }
}
