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
import { registerIpcHandler } from './registry'

function assertTrustedRenderer(event: IpcMainInvokeEvent): void {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (!owner || owner.isDestroyed() || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Untrusted assistant IPC sender')
  }
}

export function registerAssistantIpc(): void {
  registerIpcHandler('assistant:publishHostContext', (input) => hostContextSnapshotSchema.parse(input), (snapshot, event) => {
    assertTrustedRenderer(event)
    publishAssistantHostContext(event.sender.id, snapshot)
  })
  registerIpcHandler('assistant:frontendTool:ack', (input) => frontendToolAcknowledgementSchema.parse(input), (acknowledgement, event) => {
    assertTrustedRenderer(event)
    acknowledgeAssistantFrontendTool(event.sender.id, acknowledgement)
  })
  registerIpcHandler('assistant:frontendTool:result', (input) => frontendToolResultSchema.parse(input), (result, event) => {
    assertTrustedRenderer(event)
    completeAssistantFrontendTool(event.sender.id, result)
  })
}
