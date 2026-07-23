import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'

import {
  frontendToolAcknowledgementSchema,
  frontendToolResultSchema,
  hostContextSnapshotSchema,
} from '../../../src/core/assistant/hostContracts'
import {
  acknowledgeAssistantFrontendTool,
  completeAssistantFrontendTool,
  publishAssistantHostContext,
} from '../services/assistant/frontend-tool-bridge'
import { getMainWindow } from '../window'
import { registerIpcHandler } from './registry'

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
