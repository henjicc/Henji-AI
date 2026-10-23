import type { MemoryEntry, MemorySnapshot, MemorySettings, MemoryHistoryEntry } from '../../src/core/assistant/memoryEntries'
import type { MemoryWrite } from '../../src/core/assistant/memoryOperations'





import type {
  AssistantUserInstructions,
  AssistantUserInstructionsUpdate,
} from '../../src/core/assistant/userInstructions'
import type {
  AssistantSkillDetail,
  AssistantSkillEnabledUpdate,
  AssistantSkillInstallRequest,
  AssistantSkillInstallResult,
  AssistantSkillManifest,
  AssistantSkillReadRequest,
} from '../../src/core/assistant/skills'


export interface HenjiIpcErrorEnvelope {
  name: string
  message: string
  code: string
  stack?: string
  paidFailureFacts?: import('../../src/core/application-control/paidApproval').PaidFailureFacts
}

/** 普通值穿过 contextBridge，在 PAL 中恢复 Error，避免丢失结构化事实。 */
export type HenjiIpcResultEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: HenjiIpcErrorEnvelope }

export type HenjiEmbeddedAgentApi = Omit<import('../../src/core/assistant/embeddedAgent').EmbeddedAgentPlatform, 'prompt'> & {
  prompt(input: import('../../src/core/assistant/embeddedAgent').EmbeddedAgentPrompt): Promise<HenjiIpcResultEnvelope<void>>
}

export interface HenjiAssistantApi {
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
