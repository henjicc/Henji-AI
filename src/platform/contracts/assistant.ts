import type { MemoryEntry, MemorySnapshot, MemorySettings, MemoryHistoryEntry } from '@/core/assistant/memoryEntries'
import type { MemoryWrite } from '@/core/assistant/memoryOperations'


import type {
  AssistantUserInstructions,
  AssistantUserInstructionsUpdate,
} from '@/core/assistant/userInstructions'
import type {
  AssistantSkillDetail,
  AssistantSkillEnabledUpdate,
  AssistantSkillInstallRequest,
  AssistantSkillInstallResult,
  AssistantSkillManifest,
  AssistantSkillReadRequest,
} from '@/core/assistant/skills'





export interface AssistantPlatform {
  getUserInstructions(): Promise<AssistantUserInstructions>
  updateUserInstructions(update: AssistantUserInstructionsUpdate): Promise<AssistantUserInstructions>
  resetUserInstructions(): Promise<AssistantUserInstructions>
  openUserInstructionsFile(): Promise<string>
  listSkills(): Promise<AssistantSkillManifest>
  readSkill(request: AssistantSkillReadRequest): Promise<AssistantSkillDetail>
  installSkill(request: AssistantSkillInstallRequest): Promise<AssistantSkillInstallResult>
  uninstallSkill(name: string): Promise<void>
  setSkillEnabled(update: AssistantSkillEnabledUpdate): Promise<AssistantSkillManifest>
  openSkillsDirectory(): Promise<string>
  onMemoryChange(handler: () => void): () => void
  getMemoryState(): Promise<MemorySnapshot>
  updateMemorySettings(update: MemorySettings): Promise<MemorySnapshot>
  readProjectMemory(projectId: string): Promise<MemoryEntry[]>
  writeMemory(input: MemoryWrite): Promise<MemoryHistoryEntry | null>
  recordMemoryChange(change: MemoryHistoryEntry): Promise<MemorySnapshot>
  requestMemoryOrganization(): Promise<void>
  markMemoryOrganized(changes: number): Promise<void>
}
