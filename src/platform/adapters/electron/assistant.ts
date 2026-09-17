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
    listSkills: () => getNativeAssistant().listSkills(),
    readSkill: (request) => getNativeAssistant().readSkill(request),
    installSkill: (request) => getNativeAssistant().installSkill(request),
    uninstallSkill: (name) => getNativeAssistant().uninstallSkill(name),
    setSkillEnabled: (update) => getNativeAssistant().setSkillEnabled(update),
    openSkillsDirectory: () => getNativeAssistant().openSkillsDirectory(),
    getSharedMemory: () => getNativeAssistant().getSharedMemory(),
    updateSharedMemory: update => getNativeAssistant().updateSharedMemory(update),
    getMemoryState: () => getNativeAssistant().getMemoryState(),
    updateMemorySettings: (update) => getNativeAssistant().updateMemorySettings(update),
    updateMemory: (update) => getNativeAssistant().updateMemory(update),
    confirmMemoryCandidate: (candidateId) => getNativeAssistant().confirmMemoryCandidate(candidateId),
    rejectMemoryCandidate: (candidateId) => getNativeAssistant().rejectMemoryCandidate(candidateId),
    deleteMemory: (memoryId) => getNativeAssistant().deleteMemory(memoryId),
    clearMemories: (scope) => getNativeAssistant().clearMemories(scope),
  }
}
