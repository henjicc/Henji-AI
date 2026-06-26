import type { WebContents } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export interface StartNativeFileDragPayload {
  filePath: string
  iconPath?: string
}

function ensureReadableFile(filePath: string): void {
  if (!path.isAbsolute(filePath)) {
    throw new Error('Drag file path must be absolute')
  }
  const stat = fs.statSync(filePath)
  if (!stat.isFile()) {
    throw new Error('Drag file path must point to a file')
  }
}

export function startNativeFileDrag(webContents: WebContents, payload: StartNativeFileDragPayload): void {
  ensureReadableFile(payload.filePath)
  const iconPath = payload.iconPath && path.isAbsolute(payload.iconPath) && fs.existsSync(payload.iconPath)
    ? payload.iconPath
    : payload.filePath
  webContents.startDrag({
    file: payload.filePath,
    icon: iconPath,
  })
}
