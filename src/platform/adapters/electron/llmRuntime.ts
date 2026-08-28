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
    setProviderApiKey: async (credentialId, apiKey) => {
      await getNativeLlm().setProviderApiKey(credentialId, apiKey)
    },
    removeProviderApiKey: async (credentialId) => {
      await getNativeLlm().removeProviderApiKey(credentialId)
    },
    getProviderApiKey: async (credentialId) => {
      return await getNativeLlm().getProviderApiKey(credentialId)
    },
    getProviderKeyStatus: async (credentialIds) => {
      return await getNativeLlm().getProviderKeyStatus(credentialIds)
    },
    readConfig: async () => await getNativeLlm().readConfig(),
    writeConfig: async config => await getNativeLlm().writeConfig(config),
    commitProviderSettings: async request => await getNativeLlm().commitProviderSettings(request),
    deleteProviderSettings: async request => await getNativeLlm().deleteProviderSettings(request),
    chatStream: async (request, onEvent) => {
      await getNativeLlm().chatStream(request, onEvent)
    },
    modelStep: async (input, onEvent) => {
      return await getNativeLlm().modelStep(input, onEvent)
    },
    verifyModelCapabilities: async (request) => {
      return await getNativeLlm().verifyModelCapabilities(request)
    },
    cancelTask: async (taskId) => {
      await getNativeLlm().cancelTask(taskId)
    },
  }
}
