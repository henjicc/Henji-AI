


import {
  assistantUserInstructionsUpdateSchema,
  type AssistantUserInstructions,
  type AssistantUserInstructionsUpdate,
} from '@/core/assistant/userInstructions'



import {
  agentMemoryClearSchema,
  agentMemoryCandidateIdSchema,
  agentMemoryIdSchema,
  agentMemorySettingsUpdateSchema,
  agentMemoryUpdateSchema,
  type AgentMemoryRecord,
  type AgentMemoryScope,
  type AgentMemorySettings,
  type AgentMemorySettingsUpdate,
  type AgentMemoryState,
  type AgentMemoryUpdate,
} from '@/core/assistant/memory'
import {
  assistantSkillEnabledUpdateSchema,
  assistantSkillInstallRequestSchema,
  assistantSkillNameSchema,
  assistantSkillReadRequestSchema,
  type AssistantSkillDetail,
  type AssistantSkillEnabledUpdate,
  type AssistantSkillInstallRequest,
  type AssistantSkillInstallResult,
  type AssistantSkillManifest,
  type AssistantSkillReadRequest,
} from '@/core/assistant/skills'
import { getPlatform, isDesktopRuntime } from '@/platform/runtime'

export async function getAssistantUserInstructions(): Promise<AssistantUserInstructions> {
  if (!isDesktopRuntime()) throw new Error('智能助手用户指令仅在桌面应用中可用')
  return await getPlatform().assistant.getUserInstructions()
}

export async function updateAssistantUserInstructions(
  update: AssistantUserInstructionsUpdate
): Promise<AssistantUserInstructions> {
  if (!isDesktopRuntime()) throw new Error('智能助手用户指令仅在桌面应用中可用')
  const parsed = assistantUserInstructionsUpdateSchema.parse(update)
  return await getPlatform().assistant.updateUserInstructions(parsed)
}

export async function resetAssistantUserInstructions(): Promise<AssistantUserInstructions> {
  if (!isDesktopRuntime()) throw new Error('智能助手用户指令仅在桌面应用中可用')
  return await getPlatform().assistant.resetUserInstructions()
}

export async function openAssistantUserInstructionsFile(): Promise<string> {
  if (!isDesktopRuntime()) throw new Error('智能助手用户指令仅在桌面应用中可用')
  return await getPlatform().assistant.openUserInstructionsFile()
}

const SKILLS_DESKTOP_ONLY = '智能助手技能仅在桌面应用中可用'

export async function listAssistantSkills(): Promise<AssistantSkillManifest> {
  if (!isDesktopRuntime()) throw new Error(SKILLS_DESKTOP_ONLY)
  return await getPlatform().assistant.listSkills()
}

export async function readAssistantSkill(
  request: AssistantSkillReadRequest
): Promise<AssistantSkillDetail> {
  if (!isDesktopRuntime()) throw new Error(SKILLS_DESKTOP_ONLY)
  return await getPlatform().assistant.readSkill(assistantSkillReadRequestSchema.parse(request))
}

export async function installAssistantSkill(
  request: AssistantSkillInstallRequest
): Promise<AssistantSkillInstallResult> {
  if (!isDesktopRuntime()) throw new Error(SKILLS_DESKTOP_ONLY)
  return await getPlatform().assistant.installSkill(assistantSkillInstallRequestSchema.parse(request))
}

export async function uninstallAssistantSkill(name: string): Promise<void> {
  if (!isDesktopRuntime()) throw new Error(SKILLS_DESKTOP_ONLY)
  await getPlatform().assistant.uninstallSkill(assistantSkillNameSchema.parse(name))
}

export async function setAssistantSkillEnabled(
  update: AssistantSkillEnabledUpdate
): Promise<AssistantSkillManifest> {
  if (!isDesktopRuntime()) throw new Error(SKILLS_DESKTOP_ONLY)
  return await getPlatform().assistant.setSkillEnabled(assistantSkillEnabledUpdateSchema.parse(update))
}

export async function openAssistantSkillsDirectory(): Promise<string> {
  if (!isDesktopRuntime()) throw new Error(SKILLS_DESKTOP_ONLY)
  return await getPlatform().assistant.openSkillsDirectory()
}

export async function getAgentMemoryState(): Promise<AgentMemoryState> {
  if (!isDesktopRuntime()) throw new Error('智能助手记忆仅在桌面应用中可用')
  return await getPlatform().assistant.getMemoryState()
}

export async function updateAgentMemorySettings(
  update: AgentMemorySettingsUpdate
): Promise<AgentMemorySettings> {
  if (!isDesktopRuntime()) throw new Error('智能助手记忆仅在桌面应用中可用')
  return await getPlatform().assistant.updateMemorySettings(
    agentMemorySettingsUpdateSchema.parse(update)
  )
}

export async function updateAgentMemoryRecord(
  update: AgentMemoryUpdate
): Promise<AgentMemoryRecord> {
  if (!isDesktopRuntime()) throw new Error('智能助手记忆仅在桌面应用中可用')
  return await getPlatform().assistant.updateMemory(agentMemoryUpdateSchema.parse(update))
}

export async function deleteAgentMemory(memoryId: string): Promise<void> {
  if (!isDesktopRuntime()) throw new Error('智能助手记忆仅在桌面应用中可用')
  const parsed = agentMemoryIdSchema.parse({ memoryId })
  await getPlatform().assistant.deleteMemory(parsed.memoryId)
}

export async function confirmAgentMemoryCandidate(
  candidateId: string
): Promise<AgentMemoryRecord> {
  if (!isDesktopRuntime()) throw new Error('智能助手记忆仅在桌面应用中可用')
  const parsed = agentMemoryCandidateIdSchema.parse({ candidateId })
  return await getPlatform().assistant.confirmMemoryCandidate(parsed.candidateId)
}

export async function rejectAgentMemoryCandidate(candidateId: string): Promise<void> {
  if (!isDesktopRuntime()) throw new Error('智能助手记忆仅在桌面应用中可用')
  const parsed = agentMemoryCandidateIdSchema.parse({ candidateId })
  await getPlatform().assistant.rejectMemoryCandidate(parsed.candidateId)
}

export async function clearAgentMemory(scope?: AgentMemoryScope): Promise<number> {
  if (!isDesktopRuntime()) throw new Error('智能助手记忆仅在桌面应用中可用')
  const parsed = agentMemoryClearSchema.parse({ scope })
  return await getPlatform().assistant.clearMemories(parsed.scope)
}
