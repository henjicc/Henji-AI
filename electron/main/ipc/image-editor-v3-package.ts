import { BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron'
import type { ImageEditCommandHistorySnapshotV3 } from '../../../src/core/imageEdit/v3/commandHistoryCodec'
import type { ImageEditorV3DocumentSnapshot } from '../../../src/platform/contracts/imageEditorV3'
import { sanitizeFileStem } from '../services/image/path-utils'
import {
  DocumentRevisionConflictError,
  PendingHenjiImagePackageImportRegistry,
  toDocumentRef,
  type HenjiImagePackageCodec,
  type ImageEditDocumentEnvelope,
  type ImageEditDocumentRepository,
  type PendingHenjiImagePackageImport,
  type PendingHenjiImagePackageRef,
} from '../services/image-editor-v3'
import { createMainLogger } from '../services/logging'
import {
  parseImageEditorV3BasePayload,
  parseImageEditorV3RelinkPackageExternalSourcePayload,
  parseImageEditorV3SavePackagePayload,
} from './image-editor-v3-payloads'
import { registerIpcHandler } from './registry'

const logger = createMainLogger('main.image_editor_v3.package_ipc')
const pendingImports = new PendingHenjiImagePackageImportRegistry()

type RunRequestV3 = <T>(
  operation: string,
  requestId: string,
  senderId: number,
  handler: (signal: AbortSignal) => Promise<T>,
  estimatedBytes?: number,
) => Promise<T>

export interface ImageEditorV3PackageIpcDependencies {
  documents: ImageEditDocumentRepository
  packages: HenjiImagePackageCodec
  guard(event: IpcMainInvokeEvent): void
  runRequest: RunRequestV3
  toSnapshot(document: ImageEditDocumentEnvelope, signal: AbortSignal): Promise<ImageEditorV3DocumentSnapshot>
  assertHistoryResourceSizes(history: ImageEditCommandHistorySnapshotV3 | null | undefined): Promise<void>
  validateSnapshotDocument(document: ImageEditDocumentEnvelope): void
}

function ownerFor(event: IpcMainInvokeEvent): BrowserWindow {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (!owner) throw new Error('Image editor window is unavailable')
  return owner
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function packageFileName(raw: string | undefined, documentId: string): string {
  const stem = sanitizeFileStem(raw ?? documentId)
  return stem.toLowerCase().endsWith('.henjiimg') ? stem : `${stem}.henjiimg`
}

function packageThumbnail(imported: PendingHenjiImagePackageImport['imported']): {
  bytes: ArrayBuffer
  mediaType: 'image/png' | 'image/webp'
} | null {
  if (!imported.thumbnail || !imported.manifest.thumbnail) return null
  const mediaType = imported.manifest.thumbnail.mediaType
  if (mediaType !== 'image/png' && mediaType !== 'image/webp') {
    throw new Error(`Unsupported package thumbnail media type: ${mediaType}`)
  }
  return { bytes: toArrayBuffer(imported.thumbnail), mediaType }
}

function pendingPackageValue(record: PendingHenjiImagePackageImport): Record<string, unknown> {
  return {
    kind: 'relink-required',
    pendingPackageRef: record.ref,
    missingExternalSources: [...record.missingExternalSources.values()].map((source) => ({
      resourceRef: source.resourceId,
      fingerprint: { algorithm: 'sha256', value: source.sha256 },
      byteLength: source.byteLength ?? null,
      mediaType: source.mediaType ?? null,
      pathHint: source.pathHint ?? null,
      relinkHint: source.relinkHint ?? null,
    })),
    thumbnail: packageThumbnail(record.imported),
  }
}

async function persistImportedDocument(
  imported: ImageEditDocumentEnvelope,
  dependencies: ImageEditorV3PackageIpcDependencies,
): Promise<ImageEditDocumentEnvelope> {
  dependencies.validateSnapshotDocument(imported)
  let current: ImageEditDocumentEnvelope | null
  try {
    current = await dependencies.documents.load(imported.documentId)
  } catch (error) {
    if (!isNotFound(error)) throw error
    current = null
  }
  if (!current) {
    return dependencies.documents.create({
      documentId: imported.documentId,
      revision: imported.revision,
      document: imported.document,
      history: imported.history,
      resourceRefs: imported.resourceRefs,
      previewRef: imported.previewRef,
    })
  }
  const matches = JSON.stringify(current.document) === JSON.stringify(imported.document)
    && JSON.stringify(current.history) === JSON.stringify(imported.history)
    && JSON.stringify(current.resourceRefs) === JSON.stringify(imported.resourceRefs)
    && current.previewRef === imported.previewRef
    && current.revision === imported.revision
  if (!matches) throw new Error(`Image edit document already exists with different content: ${imported.documentId}`)
  return current
}

async function completePackageOpen(
  imported: PendingHenjiImagePackageImport['imported'],
  signal: AbortSignal,
  dependencies: ImageEditorV3PackageIpcDependencies,
): Promise<Record<string, unknown>> {
  const document = await persistImportedDocument(imported.manifest.document, dependencies)
  const snapshot = await dependencies.toSnapshot(document, signal)
  return {
    kind: 'ready', snapshot, resources: snapshot.resources,
    thumbnail: packageThumbnail(imported),
  }
}

export function registerImageEditorV3PackageIpc(
  dependencies: ImageEditorV3PackageIpcDependencies,
): void {
  const { guard, runRequest, documents, packages } = dependencies
  registerIpcHandler('imageEditorV3:package:open', parseImageEditorV3BasePayload, (payload, event) => (
    runRequest('package.open', payload.requestId, event.sender.id, async (signal) => {
      const selection = await dialog.showOpenDialog(ownerFor(event), {
        properties: ['openFile'], filters: [{ name: '痕迹可编辑图片', extensions: ['henjiimg'] }],
      })
      if (selection.canceled || !selection.filePaths[0]) {
        logger.info('用户取消打开可编辑图片包', {
          event: 'image_editor_v3.package.open.dialog_cancelled', requestId: payload.requestId,
        })
        return { status: 'cancelled' as const }
      }
      const imported = await packages.import(selection.filePaths[0], { signal })
      if (imported.missingExternalSources.length > 0) {
        const pending = await pendingImports.create(event.sender.id, imported)
        return { status: 'completed' as const, value: pendingPackageValue(pending) }
      }
      try {
        return { status: 'completed' as const, value: await completePackageOpen(imported, signal, dependencies) }
      } finally {
        await imported.resourceLease.release()
      }
    })
  ), guard)
  registerIpcHandler(
    'imageEditorV3:package:relinkExternalSource',
    parseImageEditorV3RelinkPackageExternalSourcePayload,
    (payload, event) => runRequest(
      'package.relink_external_source', payload.requestId, event.sender.id, async (signal) => {
        const pendingRef = payload.pendingPackageRef as PendingHenjiImagePackageRef
        const pending = pendingImports.get(event.sender.id, pendingRef)
        const externalSource = pending.missingExternalSources.get(payload.resourceRef)
        if (!externalSource) throw new Error('Requested external package resource is not missing')
        const selection = await dialog.showOpenDialog(ownerFor(event), {
          properties: ['openFile'],
          title: externalSource.relinkHint ? `重新链接 ${externalSource.relinkHint}` : '重新链接外部图片',
          filters: [{
            name: '图片',
            extensions: ['png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'avif', 'heif', 'heic'],
          }],
        })
        if (selection.canceled || !selection.filePaths[0]) {
          await pendingImports.abandon(event.sender.id, pendingRef)
          return { status: 'cancelled' as const }
        }
        try {
          const relinked = await packages.relinkExternalSource(selection.filePaths[0], externalSource, signal)
          try {
            pendingImports.addRelinkedResource(pending, relinked.resource, relinked.resourceLease)
          } catch (error) {
            await relinked.resourceLease.release()
            throw error
          }
          if (pending.missingExternalSources.size > 0) {
            return { status: 'completed' as const, value: pendingPackageValue(pending) }
          }
          const ready = pendingImports.takeReady(event.sender.id, pendingRef)
          try {
            return { status: 'completed' as const, value: await completePackageOpen(ready.imported, signal, dependencies) }
          } finally {
            await pendingImports.release(ready)
          }
        } catch (error) {
          await pendingImports.abandon(event.sender.id, pendingRef)
          throw error
        }
      },
    ),
    guard,
  )
  registerIpcHandler('imageEditorV3:package:saveAs', parseImageEditorV3SavePackagePayload, (payload, event) => (
    runRequest('package.save_as', payload.requestId, event.sender.id, async (signal) => {
      const document = await documents.load(payload.documentRef)
      await dependencies.assertHistoryResourceSizes(document.history)
      if (document.revision !== payload.revision) {
        throw new DocumentRevisionConflictError(document.documentId, payload.revision, document.revision)
      }
      const selection = await dialog.showSaveDialog(ownerFor(event), {
        defaultPath: packageFileName(payload.suggestedName, document.documentId),
        filters: [{ name: '痕迹可编辑图片', extensions: ['henjiimg'] }],
      })
      if (selection.canceled || !selection.filePath) {
        logger.info('用户取消另存可编辑图片包', {
          event: 'image_editor_v3.package.save_as.dialog_cancelled', requestId: payload.requestId,
        })
        return { status: 'cancelled' as const }
      }
      const targetPath = selection.filePath.toLowerCase().endsWith('.henjiimg')
        ? selection.filePath
        : `${selection.filePath}.henjiimg`
      await packages.export({ targetPath, document, signal, thumbnail: payload.thumbnail })
      return { status: 'completed' as const, value: {
        outputRef: `henjiimg:${document.documentId}@${document.revision}`,
        documentRef: toDocumentRef(document.documentId), revision: document.revision,
      } }
    })
  ), guard)
}

export async function abandonImageEditorV3PendingPackageImports(senderId: number): Promise<void> {
  await pendingImports.abandonOwner(senderId)
}

export async function disposeImageEditorV3PendingPackageImports(): Promise<void> {
  await pendingImports.dispose()
}
