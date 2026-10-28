import type { LlmRuntimePlatform } from '@/platform/contracts/llmRuntime'
import { unwrapIpcResult } from './ipcResult'

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
    getProviderKeyStatus: async (credentialIds) => {
      return await getNativeLlm().getProviderKeyStatus(credentialIds)
    },
    readConfig: async () => await getNativeLlm().readConfig(),
    writeConfig: async config => await getNativeLlm().writeConfig(config),
    commitProviderSettings: async request => await getNativeLlm().commitProviderSettings(request),
    deleteProviderSettings: async request => await getNativeLlm().deleteProviderSettings(request),
    chatStream: async (request, onEvent) => {
      unwrapIpcResult(await getNativeLlm().chatStream(request, onEvent))
    },
    modelStep: async (input, onEvent) => {
      return unwrapIpcResult<Awaited<ReturnType<LlmRuntimePlatform['modelStep']>>>(await getNativeLlm().modelStep(input, onEvent))
    },
    verifyModelCapabilities: async (request) => {
      return unwrapIpcResult<Awaited<ReturnType<LlmRuntimePlatform['verifyModelCapabilities']>>>(await getNativeLlm().verifyModelCapabilities(request))
    },
    cancelTask: async (taskId) => {
      await getNativeLlm().cancelTask(taskId)
    },
  }
}
