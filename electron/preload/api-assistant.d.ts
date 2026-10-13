import type { SharedMemorySnapshot, SharedMemoryUpdate } from '../../src/core/assistant/memory'





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
import type {
  AgentMemoryRecord,
  AgentMemoryScope,
  AgentMemorySettings,
  AgentMemorySettingsUpdate,
  AgentMemoryState,
  AgentMemoryUpdate,
} from '../../src/core/assistant/memory'


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
  getSharedMemory(): Promise<SharedMemorySnapshot>
  updateSharedMemory(update: SharedMemoryUpdate): Promise<SharedMemorySnapshot>
  getMemoryState(): Promise<AgentMemoryState>
  updateMemorySettings(update: AgentMemorySettingsUpdate): Promise<AgentMemorySettings>
  updateMemory(update: AgentMemoryUpdate): Promise<AgentMemoryRecord>
  confirmMemoryCandidate(candidateId: string): Promise<AgentMemoryRecord>
  rejectMemoryCandidate(candidateId: string): Promise<void>
  deleteMemory(memoryId: string): Promise<void>
  clearMemories(scope?: AgentMemoryScope): Promise<number>
}
