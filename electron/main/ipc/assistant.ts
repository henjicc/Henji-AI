import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'

import {
  frontendToolAcknowledgementSchema,
  frontendToolResultSchema,
  parseHostContextSnapshot,
} from '../../../src/core/assistant/hostContracts'
import { assistantUserInstructionsUpdateSchema } from '../../../src/core/assistant/userInstructions'
import {
  agentMemoryClearSchema,
  agentMemoryCandidateIdSchema,
  agentMemoryIdSchema,
  agentMemorySettingsUpdateSchema,
  agentMemoryUpdateSchema,
} from '../../../src/core/assistant/memory'
import {
  acknowledgeAssistantFrontendTool,
  completeAssistantFrontendTool,
  publishAssistantHostContext,
} from '../services/assistant/frontend-tool-bridge'
import {
  getAssistantUserInstructions,
  openAssistantUserInstructionsFile,
  resetAssistantUserInstructions,
  updateAssistantUserInstructions,
} from '../services/assistant/user-instructions'
import {
  assistantSkillEnabledUpdateSchema,
  assistantSkillInstallRequestSchema,
  assistantSkillNameRequestSchema,
  assistantSkillReadRequestSchema,
} from '../../../src/core/assistant/skills'
import {
  installAssistantSkill,
  openAssistantSkillsDirectory,
  uninstallAssistantSkill,
} from '../services/assistant/skills/install'
import {
  listAssistantSkills,
  readAssistantSkill,
} from '../services/assistant/skills/registry'
import { setAssistantSkillEnabled } from '../services/assistant/skills/state'
import {
  clearAgentMemories,
  getAgentMemoryStore,
  updateAgentMemory,
  updateAgentMemorySettings,
} from '../services/assistant/memory'
import { getMainWindow } from '../window'
import { parseVoid, registerIpcHandler } from './registry'

export function assertTrustedAssistantRenderer(event: IpcMainInvokeEvent): void {
  const owner = BrowserWindow.fromWebContents(event.sender)
  const mainWindow = getMainWindow()
  if (!owner || owner !== mainWindow || owner.isDestroyed() || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Untrusted assistant IPC sender')
  }
  const frameUrl = event.senderFrame.url
  const developmentUrl = process.env['ELECTRON_RENDERER_URL']
  if (developmentUrl) {
    if (new URL(frameUrl).origin !== new URL(developmentUrl).origin) throw new Error('Untrusted assistant IPC origin')
  } else if (!frameUrl.startsWith('file://')) {
    throw new Error('Untrusted assistant IPC origin')
  }
}

export function registerAssistantIpc(): void {
  registerIpcHandler(
    'assistant:userInstructions:get',
    parseVoid,
    () => getAssistantUserInstructions(),
    assertTrustedAssistantRenderer
  )
  registerIpcHandler(
    'assistant:userInstructions:update',
    (input) => assistantUserInstructionsUpdateSchema.parse(input),
    (update) => updateAssistantUserInstructions(update),
    assertTrustedAssistantRenderer
  )
  registerIpcHandler(
    'assistant:userInstructions:reset',
    parseVoid,
    () => resetAssistantUserInstructions(),
    assertTrustedAssistantRenderer
  )
  registerIpcHandler(
    'assistant:userInstructions:openFile',
    parseVoid,
    () => openAssistantUserInstructionsFile(),
    assertTrustedAssistantRenderer
  )
  registerIpcHandler(
    'assistant:skills:list',
    parseVoid,
    () => listAssistantSkills(),
    assertTrustedAssistantRenderer
  )
  registerIpcHandler(
    'assistant:skills:read',
    (input) => assistantSkillReadRequestSchema.parse(input),
    ({ name, path }) => readAssistantSkill(name, path),
    assertTrustedAssistantRenderer
  )
  registerIpcHandler(
    'assistant:skills:install',
    (input) => assistantSkillInstallRequestSchema.parse(input),
    (request) => installAssistantSkill(request),
    assertTrustedAssistantRenderer
  )
  registerIpcHandler(
    'assistant:skills:uninstall',
    (input) => assistantSkillNameRequestSchema.parse(input),
    ({ name }) => uninstallAssistantSkill(name),
    assertTrustedAssistantRenderer
  )
  registerIpcHandler(
    'assistant:skills:openDir',
    parseVoid,
    () => openAssistantSkillsDirectory(),
    assertTrustedAssistantRenderer
  )
  registerIpcHandler(
    'assistant:skills:setEnabled',
    (input) => assistantSkillEnabledUpdateSchema.parse(input),
    ({ name, enabled }) => {
      setAssistantSkillEnabled(name, enabled)
      return listAssistantSkills()
    },
    assertTrustedAssistantRenderer
  )
  registerIpcHandler(
    'assistant:memory:getState',
    parseVoid,
    () => getAgentMemoryStore().getState(),
    assertTrustedAssistantRenderer
  )
  registerIpcHandler(
    'assistant:memory:updateSettings',
    (input) => agentMemorySettingsUpdateSchema.parse(input),
    (update) => updateAgentMemorySettings(update),
    assertTrustedAssistantRenderer
  )
  registerIpcHandler(
    'assistant:memory:update',
    (input) => agentMemoryUpdateSchema.parse(input),
    (update) => updateAgentMemory(update),
    assertTrustedAssistantRenderer
  )
  registerIpcHandler(
    'assistant:memory:confirmCandidate',
    (input) => agentMemoryCandidateIdSchema.parse(input),
    ({ candidateId }) => getAgentMemoryStore().confirm(candidateId),
    assertTrustedAssistantRenderer
  )
  registerIpcHandler(
    'assistant:memory:rejectCandidate',
    (input) => agentMemoryCandidateIdSchema.parse(input),
    ({ candidateId }) => getAgentMemoryStore().reject(candidateId),
    assertTrustedAssistantRenderer
  )
  registerIpcHandler(
    'assistant:memory:delete',
    (input) => agentMemoryIdSchema.parse(input),
    ({ memoryId }) => getAgentMemoryStore().delete(memoryId),
    assertTrustedAssistantRenderer
  )
  registerIpcHandler(
    'assistant:memory:clear',
    (input) => agentMemoryClearSchema.parse(input ?? {}),
    ({ scope }) => clearAgentMemories(scope),
    assertTrustedAssistantRenderer
  )
  registerIpcHandler('assistant:publishHostContext', (input) => parseHostContextSnapshot(input), (snapshot, event) => {
    publishAssistantHostContext(event.sender.id, snapshot)
  }, assertTrustedAssistantRenderer)
  registerIpcHandler('assistant:frontendTool:ack', (input) => frontendToolAcknowledgementSchema.parse(input), (acknowledgement, event) => {
    acknowledgeAssistantFrontendTool(event.sender.id, acknowledgement)
  }, assertTrustedAssistantRenderer)
  registerIpcHandler('assistant:frontendTool:result', (input) => frontendToolResultSchema.parse(input), (result, event) => {
    completeAssistantFrontendTool(event.sender.id, result)
  }, assertTrustedAssistantRenderer)
}
