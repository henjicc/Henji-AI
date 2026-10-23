import { z } from 'zod'
import { memorySettingsSchema, memoryHistoryEntrySchema } from '../../../src/core/assistant/memoryEntries'
import { memoryWriteSchema } from '../../../src/core/assistant/memoryOperations'
import { getDocumentService } from '../services/documents/runtime'
import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'


import { assistantUserInstructionsUpdateSchema } from '../../../src/core/assistant/userInstructions'

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
import { getAgentMemoryStore } from '../services/assistant/memory'
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
  getAgentMemoryStore().onMemoryChange(() => { const window = getMainWindow(); if (window && !window.isDestroyed()) window.webContents.send('assistant:memory:changed') })
  const enabled = (): void => { if (!getAgentMemoryStore().getState().settings.enabled) throw new Error('MEMORY_DISABLED：记忆已关闭。') }
  registerIpcHandler('assistant:memory:getState', parseVoid, () => getAgentMemoryStore().read(), assertTrustedAssistantRenderer)
  registerIpcHandler('assistant:memory:updateSettings', input => memorySettingsSchema.parse(input), input => getAgentMemoryStore().updateSettings(input), assertTrustedAssistantRenderer)
  registerIpcHandler('assistant:memory:readProject', input => z.object({ projectId: z.string().min(1) }).strict().parse(input), async ({ projectId }) => { enabled(); return getDocumentService().readProjectMemory(projectId) }, assertTrustedAssistantRenderer)
  registerIpcHandler('assistant:memory:write', input => memoryWriteSchema.parse(input), async input => {
    enabled()
    if (input.target.layer === 'global') {
      const before = getAgentMemoryStore().getState().revision
      const after = getAgentMemoryStore().write(input)
      return before === after.revision ? null : after.history.at(-1) ?? null
    }
    if (input.target.layer !== 'project') throw new Error('INVALID_TARGET：风格记忆通过风格库保存。')
    const change = await getDocumentService().writeProjectMemory(input, enabled, change => { getAgentMemoryStore().recordExternal(change) })
    return change
  }, assertTrustedAssistantRenderer)
  registerIpcHandler('assistant:memory:recordChange', input => memoryHistoryEntrySchema.parse(input), input => getAgentMemoryStore().recordExternal(input), assertTrustedAssistantRenderer)
  registerIpcHandler('assistant:memory:requestOrganization', parseVoid, () => { enabled(); getAgentMemoryStore().requestOrganization() }, assertTrustedAssistantRenderer)
  registerIpcHandler('assistant:memory:organized', input => z.object({ changes: z.number().int().nonnegative() }).strict().parse(input), ({ changes }) => { enabled(); getAgentMemoryStore().markOrganized(changes) }, assertTrustedAssistantRenderer)
}
