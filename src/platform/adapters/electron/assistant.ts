import type { AssistantPlatform } from '@/platform/contracts/assistant'

const DOMAIN = 'assistant'

function getNativeAssistant(): NonNullable<typeof window.henjiNative>['assistant'] {
  const native = window.henjiNative
  if (!native?.assistant) throw new Error(`[platform:${DOMAIN}] henjiNative.assistant is not available`)
  return native.assistant
}

export function createElectronAssistant(): AssistantPlatform {
  return {
    getUserInstructions: () => getNativeAssistant().getUserInstructions(),
    updateUserInstructions: (update) => getNativeAssistant().updateUserInstructions(update),
    resetUserInstructions: () => getNativeAssistant().resetUserInstructions(),
    openUserInstructionsFile: () => getNativeAssistant().openUserInstructionsFile(),
    getMemoryState: () => getNativeAssistant().getMemoryState(),
    updateMemorySettings: (update) => getNativeAssistant().updateMemorySettings(update),
    updateMemory: (update) => getNativeAssistant().updateMemory(update),
    confirmMemoryCandidate: (candidateId) => getNativeAssistant().confirmMemoryCandidate(candidateId),
    rejectMemoryCandidate: (candidateId) => getNativeAssistant().rejectMemoryCandidate(candidateId),
    deleteMemory: (memoryId) => getNativeAssistant().deleteMemory(memoryId),
    clearMemories: (scope) => getNativeAssistant().clearMemories(scope),
    publishHostContext: (snapshot) => getNativeAssistant().publishHostContext(snapshot),
    acknowledgeFrontendTool: (acknowledgement) => getNativeAssistant().acknowledgeFrontendTool(acknowledgement),
    completeFrontendTool: (result) => getNativeAssistant().completeFrontendTool(result),
    onFrontendToolRequest: (handler) => getNativeAssistant().onFrontendToolRequest(handler),
    onFrontendToolCancel: (handler) => getNativeAssistant().onFrontendToolCancel(handler),
    startRun: (request) => getNativeAssistant().startRun(request),
    cancelRun: (request) => getNativeAssistant().cancelRun(request),
    pauseRun: (request) => getNativeAssistant().pauseRun(request),
    resumeRun: (request) => getNativeAssistant().resumeRun(request),
    respondApproval: (request) => getNativeAssistant().respondApproval(request),
    getRunState: (request) => getNativeAssistant().getRunState(request),
    getRunSnapshot: (request) => getNativeAssistant().getRunSnapshot(request),
    getRunEvents: (request) => getNativeAssistant().getRunEvents(request),
    listRuns: (request) => getNativeAssistant().listRuns(request),
    listThreads: (request) => getNativeAssistant().listThreads(request),
    getTranscript: (request) => getNativeAssistant().getTranscript(request),
    retryRun: (request) => getNativeAssistant().retryRun(request),
    subscribeEvents: (handler) => getNativeAssistant().subscribeEvents(handler),
  }
}
