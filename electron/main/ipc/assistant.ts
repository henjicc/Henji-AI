import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'

import {
  frontendToolAcknowledgementSchema,
  frontendToolResultSchema,
  hostContextSnapshotSchema,
} from '../../../src/core/assistant/hostContracts'
import { assistantModelPreferencesUpdateSchema } from '../../../src/core/assistant/modelPreferences'
import {
  acknowledgeAssistantFrontendTool,
  completeAssistantFrontendTool,
  publishAssistantHostContext,
} from '../services/assistant/frontend-tool-bridge'
import {
  getAssistantModelPreferences,
  openAssistantModelPreferencesFile,
  resetAssistantModelPreferences,
  updateAssistantModelPreferences,
} from '../services/assistant/model-preferences'
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
    'assistant:modelPreferences:get',
    parseVoid,
    () => getAssistantModelPreferences(),
    assertTrustedAssistantRenderer
  )
  registerIpcHandler(
    'assistant:modelPreferences:update',
    (input) => assistantModelPreferencesUpdateSchema.parse(input),
    (update) => updateAssistantModelPreferences(update),
    assertTrustedAssistantRenderer
  )
  registerIpcHandler(
    'assistant:modelPreferences:reset',
    parseVoid,
    () => resetAssistantModelPreferences(),
    assertTrustedAssistantRenderer
  )
  registerIpcHandler(
    'assistant:modelPreferences:openFile',
    parseVoid,
    () => openAssistantModelPreferencesFile(),
    assertTrustedAssistantRenderer
  )
  registerIpcHandler('assistant:publishHostContext', (input) => hostContextSnapshotSchema.parse(input), (snapshot, event) => {
    publishAssistantHostContext(event.sender.id, snapshot)
  }, assertTrustedAssistantRenderer)
  registerIpcHandler('assistant:frontendTool:ack', (input) => frontendToolAcknowledgementSchema.parse(input), (acknowledgement, event) => {
    acknowledgeAssistantFrontendTool(event.sender.id, acknowledgement)
  }, assertTrustedAssistantRenderer)
  registerIpcHandler('assistant:frontendTool:result', (input) => frontendToolResultSchema.parse(input), (result, event) => {
    completeAssistantFrontendTool(event.sender.id, result)
  }, assertTrustedAssistantRenderer)
}
