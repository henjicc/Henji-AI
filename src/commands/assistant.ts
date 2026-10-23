


import {
  assistantUserInstructionsUpdateSchema,
  type AssistantUserInstructions,
  type AssistantUserInstructionsUpdate,
} from '@/core/assistant/userInstructions'



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
