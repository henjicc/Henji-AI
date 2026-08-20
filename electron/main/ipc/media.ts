import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'

import type {
  ImportMediaFromBytesRequest,
  ImportMediaFromPathRequest,
  LocalMediaImportResult,
  LocalMediaKind,
  LocalMediaOwnership,
} from '../../../src/core/media/localMediaImportContracts'
import { allowMediaRoot, isPathWithinAllowedMediaRoots } from '../protocol'
import { resolveBundledResourcePath } from '../services/media/bundledResources'
import { captureApplicationSurface } from '../services/media/surfaceCapture'
import { importMediaFromBytes, importMediaFromPath } from '../services/media-import'
import { getMainWindow } from '../window'
import {
  surfaceCaptureRequestSchema,
  type SurfaceCaptureRequest,
  type SurfaceCaptureResult,
} from '../../../src/core/assistant/surfaceObservation'
import { parseRecord, registerIpcHandler } from './registry'

interface AllowRootPayload {
  rootPath: string
}

interface IsPathAllowedPayload {
  targetPath: string
}

interface BundledResourcePayload {
  relativePath: string
}

function assertTrustedMainRenderer(event: IpcMainInvokeEvent): void {
  const owner = BrowserWindow.fromWebContents(event.sender)
  const mainWindow = getMainWindow()
  if (!owner || owner !== mainWindow || owner.isDestroyed() || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Untrusted media import IPC sender')
  }
}

function readMediaKind(value: unknown): LocalMediaKind {
  if (value === 'image' || value === 'video' || value === 'audio') return value
  throw new Error('Expected media kind')
}

function readOwnership(value: unknown): LocalMediaOwnership {
  if (value === 'managed' || value === 'referenced') return value
  throw new Error('Expected media ownership')
}

function parseImportFromPathPayload(input: unknown): ImportMediaFromPathRequest {
  const record = parseRecord(input)
  const { importId, sourcePath, mimeType } = record
  if (typeof importId !== 'string' || typeof sourcePath !== 'string') {
    throw new Error('Expected media import id and source path')
  }
  if (mimeType !== undefined && typeof mimeType !== 'string') {
    throw new Error('Expected optional media mime type')
  }
  return {
    importId,
    sourcePath,
    expectedKind: readMediaKind(record.expectedKind),
    ownership: readOwnership(record.ownership),
    mimeType,
  }
}

function parseImportFromBytesPayload(input: unknown): ImportMediaFromBytesRequest {
  const record = parseRecord(input)
  const { importId, bytes, fileName, mimeType } = record
  if (typeof importId !== 'string' || typeof fileName !== 'string' || !(bytes instanceof Uint8Array)) {
    throw new Error('Expected media import id, file name, and bytes')
  }
  if (mimeType !== undefined && typeof mimeType !== 'string') {
    throw new Error('Expected optional media mime type')
  }
  return {
    importId,
    bytes,
    fileName,
    expectedKind: readMediaKind(record.expectedKind),
    mimeType,
  }
}

function parseAllowRootPayload(input: unknown): AllowRootPayload {
  const record = parseRecord(input)
  const rootPath = record.rootPath
  if (typeof rootPath !== 'string' || rootPath.length === 0) {
    throw new Error('Expected non-empty string field "rootPath"')
  }
  return { rootPath }
}

function parseIsPathAllowedPayload(input: unknown): IsPathAllowedPayload {
  const record = parseRecord(input)
  const targetPath = record.targetPath
  if (typeof targetPath !== 'string' || targetPath.length === 0) {
    throw new Error('Expected non-empty string field "targetPath"')
  }
  return { targetPath }
}

function parseBundledResourcePayload(input: unknown): BundledResourcePayload {
  const record = parseRecord(input)
  const relativePath = record.relativePath
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new Error('Expected non-empty string field "relativePath"')
  }
  return { relativePath }
}

export function registerMediaIpc(): void {
  registerIpcHandler<AllowRootPayload, void>('media:allowRoot', parseAllowRootPayload, ({ rootPath }) => {
    allowMediaRoot(rootPath)
  })

  registerIpcHandler<IsPathAllowedPayload, boolean>('media:isPathAllowed', parseIsPathAllowedPayload, ({ targetPath }) => {
    return isPathWithinAllowedMediaRoots(targetPath)
  })

  registerIpcHandler<BundledResourcePayload, string | null>(
    'media:getBundledResourcePath',
    parseBundledResourcePayload,
    ({ relativePath }) => {
      return resolveBundledResourcePath(relativePath)
    },
  )

  registerIpcHandler<SurfaceCaptureRequest, SurfaceCaptureResult>(
    'media:captureApplicationSurface',
    (input) => surfaceCaptureRequestSchema.parse(input),
    (input, event) => captureApplicationSurface(event.sender, input),
  )

  registerIpcHandler<ImportMediaFromPathRequest, LocalMediaImportResult>(
    'media:importFromPath',
    parseImportFromPathPayload,
    (input) => importMediaFromPath(input),
    assertTrustedMainRenderer,
  )

  registerIpcHandler<ImportMediaFromBytesRequest, LocalMediaImportResult>(
    'media:importFromBytes',
    parseImportFromBytesPayload,
    (input) => importMediaFromBytes(input),
    assertTrustedMainRenderer,
  )
}
