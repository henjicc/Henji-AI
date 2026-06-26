import { BrowserWindow } from 'electron'
import {
  parseStringField,
  registerIpcHandler,
} from './registry'

interface StreamEchoPayload {
  streamId: string
  message: string
}

const activeEchoStreams = new Map<string, NodeJS.Timeout>()

function parseStreamEchoPayload(input: unknown): StreamEchoPayload {
  const streamId = parseStringField(input, 'streamId')
  const message = parseStringField(input, 'message')
  return { streamId, message }
}

export function registerStreamIpc(): void {
  registerIpcHandler('diagnostics:streamEcho', parseStreamEchoPayload, (payload, event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) {
      throw new Error('Unable to resolve BrowserWindow for stream sender')
    }

    const chunks = payload.message.length > 0 ? payload.message.match(/.{1,8}/g) ?? [] : ['']
    let index = 0
    const timer = setInterval(() => {
      if (win.isDestroyed()) {
        clearInterval(timer)
        activeEchoStreams.delete(payload.streamId)
        return
      }

      const chunk = chunks[index]
      if (chunk === undefined) {
        clearInterval(timer)
        activeEchoStreams.delete(payload.streamId)
        win.webContents.send('diagnostics:streamEcho:event', {
          streamId: payload.streamId,
          type: 'done',
        })
        return
      }

      win.webContents.send('diagnostics:streamEcho:event', {
        streamId: payload.streamId,
        type: 'chunk',
        data: chunk,
      })
      index += 1
    }, 10)

    activeEchoStreams.set(payload.streamId, timer)
  })

  registerIpcHandler('diagnostics:cancelStream', (input) => parseStringField(input, 'streamId'), (streamId) => {
    const timer = activeEchoStreams.get(streamId)
    if (timer) {
      clearInterval(timer)
      activeEchoStreams.delete(streamId)
    }
  })
}
