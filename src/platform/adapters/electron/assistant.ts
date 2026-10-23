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
    onMemoryChange: handler => getNativeAssistant().onMemoryChange(handler),
    getMemoryState: () => getNativeAssistant().getMemoryState(),
    updateMemorySettings: update => getNativeAssistant().updateMemorySettings(update),
    readProjectMemory: projectId => getNativeAssistant().readProjectMemory(projectId),
    writeMemory: input => getNativeAssistant().writeMemory(input),
    recordMemoryChange: change => getNativeAssistant().recordMemoryChange(change),
    requestMemoryOrganization: () => getNativeAssistant().requestMemoryOrganization(),
    markMemoryOrganized: changes => getNativeAssistant().markMemoryOrganized(changes),
  }
}
