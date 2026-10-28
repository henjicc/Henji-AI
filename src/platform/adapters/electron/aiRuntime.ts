import type { AiRuntimePlatform } from '@/platform/contracts/aiRuntime'
import { unwrapIpcResult } from './ipcResult'

const DOMAIN = 'aiRuntime'

function getNativeAi(): NonNullable<typeof window.henjiNative>['ai'] {
  const native = window.henjiNative
  if (!native?.ai) {
    throw new Error(`[platform:${DOMAIN}] henjiNative.ai is not available`)
  }
  return native.ai
}

export function createElectronAiRuntime(): AiRuntimePlatform {
  return {
    readSavedResult: (requestId) => getNativeAi().consumePendingResult(requestId),
    setProviderApiKey: async (providerId, apiKey) => {
      await getNativeAi().setProviderApiKey(providerId, apiKey)
    },
    removeProviderApiKey: async (providerId) => {
      await getNativeAi().removeProviderApiKey(providerId)
    },
    getProviderKeyInfo: async (providerId) => {
      return await getNativeAi().getProviderKeyInfo(providerId)
    },
    getProviderKeyStatus: async () => {
      return await getNativeAi().getProviderKeyStatus()
    },
    testProviderConnection: async (providerId) => {
      return await getNativeAi().testProviderConnection(providerId)
    },
    listTtsVoices: async (modelId) => {
      return await getNativeAi().listTtsVoices(modelId)
    },
    generate: async (request) => {
      return unwrapIpcResult<Awaited<ReturnType<AiRuntimePlatform['generate']>>>(await getNativeAi().generate(request))
    },
    continuePolling: async (request) => {
      return unwrapIpcResult<Awaited<ReturnType<AiRuntimePlatform['continuePolling']>>>(await getNativeAi().continuePolling(request))
    },
    cancelTask: async (taskId) => {
      await getNativeAi().cancelTask(taskId)
    },
    getProgressEstimate: async (request) => {
      return await getNativeAi().getProgressEstimate(request)
    },
    recordProgressSample: async (request) => {
      return await getNativeAi().recordProgressSample(request)
    },
  }
}
