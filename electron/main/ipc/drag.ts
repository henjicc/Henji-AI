import { startNativeFileDrag, type StartNativeFileDragPayload } from '../services/drag'
import { parseRecord, registerIpcHandler } from './registry'

function parseStartNativeFileDragPayload(input: unknown): StartNativeFileDragPayload {
  const record = parseRecord(input)
  const filePath = record.filePath
  const iconPath = record.iconPath
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('Expected non-empty string field "filePath"')
  }
  if (iconPath !== undefined && typeof iconPath !== 'string') {
    throw new Error('Expected string field "iconPath"')
  }
  return { filePath, iconPath }
}

export function registerDragIpc(): void {
  registerIpcHandler<StartNativeFileDragPayload, void>(
    'drag:startNativeFileDrag',
    parseStartNativeFileDragPayload,
    (payload, event) => startNativeFileDrag(event.sender, payload)
  )
}
