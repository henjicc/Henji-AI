import { app, nativeImage, type NativeImage, type WebContents } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export interface StartNativeFileDragPayload {
  filePath: string
  iconPath?: string
}

const MAX_DRAG_ICON_SIZE = 100

function ensureReadableFile(filePath: string): void {
  if (!path.isAbsolute(filePath)) {
    throw new Error('Drag file path must be absolute')
  }
  const stat = fs.statSync(filePath)
  if (!stat.isFile()) {
    throw new Error('Drag file path must point to a file')
  }
}

function isReadableFile(filePath: string): boolean {
  if (!path.isAbsolute(filePath)) return false
  try {
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

function resolveBundledIconPath(): string | undefined {
  const candidates = [
    path.join(app.getAppPath(), 'src-tauri', 'icons', '32x32.png'),
    path.join(app.getAppPath(), 'src-tauri', 'icons', '128x128.png'),
  ]
  return candidates.find(isReadableFile)
}

function resizeDragIcon(image: NativeImage): NativeImage {
  const { width, height } = image.getSize()
  if (width <= 0 || height <= 0) {
    return nativeImage.createEmpty()
  }
  if (width <= MAX_DRAG_ICON_SIZE && height <= MAX_DRAG_ICON_SIZE) {
    return image
  }

  const scale = MAX_DRAG_ICON_SIZE / Math.max(width, height)
  return image.resize({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    quality: 'best',
  })
}

function loadDragIcon(filePath: string): NativeImage | null {
  if (!isReadableFile(filePath)) return null
  const image = nativeImage.createFromPath(filePath)
  if (image.isEmpty()) return null

  const resized = resizeDragIcon(image)
  return resized.isEmpty() ? null : resized
}

function resolveDragIcon(payload: StartNativeFileDragPayload): NativeImage {
  const candidates = [
    payload.iconPath,
    payload.filePath,
    resolveBundledIconPath(),
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    const icon = loadDragIcon(candidate)
    if (icon) return icon
  }

  return nativeImage.createEmpty()
}

export function startNativeFileDrag(webContents: WebContents, payload: StartNativeFileDragPayload): void {
  ensureReadableFile(payload.filePath)
  webContents.startDrag({
    file: payload.filePath,
    icon: resolveDragIcon(payload),
  })
}
