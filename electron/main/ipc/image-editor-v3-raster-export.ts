import path from 'node:path'

import { BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron'

import { sanitizeFileStem } from '../services/image/path-utils'
import { createMainLogger } from '../services/logging'
import {
  toDocumentRef,
  type ManagedRasterMaterializer,
  type RasterExportFormat,
  type RasterExportSessionManager,
} from '../services/image-editor-v3'
import {
  parseImageEditorV3RasterExportSessionPayload,
  parseImageEditorV3StartRasterExportPayload,
  parseImageEditorV3WriteRasterExportTilePayload,
} from './image-editor-v3-export-payloads'
import { registerIpcHandler, type IpcSenderGuard } from './registry'

const logger = createMainLogger('main.image_editor_v3.raster_export_ipc')

type RunRequest = <T>(
  operation: string,
  requestId: string,
  senderId: number,
  work: (signal: AbortSignal) => Promise<T>,
  estimatedBytes?: number,
) => Promise<T>

export interface RegisterRasterExportIpcOptions {
  manager: RasterExportSessionManager
  materializer: ManagedRasterMaterializer
  guard: IpcSenderGuard
  runRequest: RunRequest
}

interface ExportFormatPresentation {
  extension: string
  acceptedExtensions: string[]
  label: string
}

function formatPresentation(format: RasterExportFormat): ExportFormatPresentation {
  switch (format) {
    case 'bigtiff':
    case 'tiff8':
    case 'tiff16':
      return { extension: 'tif', acceptedExtensions: ['tif', 'tiff'], label: 'TIFF 图片' }
    case 'jpeg':
      return { extension: 'jpg', acceptedExtensions: ['jpg', 'jpeg'], label: 'JPEG 图片' }
    case 'webp':
      return { extension: 'webp', acceptedExtensions: ['webp'], label: 'WebP 图片' }
    case 'png8':
    case 'png16':
      return { extension: 'png', acceptedExtensions: ['png'], label: 'PNG 图片' }
    case 'avif10':
    case 'avif12':
      return { extension: 'avif', acceptedExtensions: ['avif'], label: 'AVIF 图片' }
  }
}

function exportFileName(raw: string | undefined, documentRef: string, format: RasterExportFormat): string {
  const presentation = formatPresentation(format)
  const stem = sanitizeFileStem(raw ?? documentRef.slice('image-edit-v3:'.length))
  const lower = stem.toLowerCase()
  return presentation.acceptedExtensions.some((extension) => lower.endsWith(`.${extension}`))
    ? stem
    : `${stem}.${presentation.extension}`
}

function normalizeSelectedPath(filePath: string, format: RasterExportFormat): string {
  if (!path.isAbsolute(filePath) || filePath.includes('\0')) {
    throw new Error('The host returned an invalid raster export path')
  }
  const presentation = formatPresentation(format)
  const parsed = path.parse(filePath)
  if (presentation.acceptedExtensions.includes(parsed.ext.slice(1).toLowerCase())) return filePath
  const name = parsed.ext ? parsed.name : parsed.base
  return path.join(parsed.dir, `${name}.${presentation.extension}`)
}

function ownerFor(event: IpcMainInvokeEvent): BrowserWindow {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (!owner) throw new Error('Image editor window is unavailable')
  return owner
}

function monitorRendererLifetime(
  manager: RasterExportSessionManager,
  event: IpcMainInvokeEvent,
  sessionId: string,
  cancel: (ownerId: number, sessionId: string, reason: string) => Promise<boolean> = (
    ownerId,
    activeSessionId,
    reason,
  ) => manager.cancel(ownerId, activeSessionId, reason),
): void {
  const sender = event.sender
  const ownerId = sender.id
  let unsubscribe = (): void => undefined
  const clear = (): void => {
    sender.off('destroyed', onDestroyed)
    sender.off('render-process-gone', onRenderProcessGone)
    sender.off('did-start-loading', onReload)
    unsubscribe()
  }
  const cancelForRenderer = (reason: string): void => {
    clear()
    void cancel(ownerId, sessionId, reason).catch((error: unknown) => {
      logger.error('渲染器生命周期变化后清理栅格导出会话失败', {
        event: 'image_editor_v3.raster_export.renderer_cleanup.failed',
        requestId: sessionId,
        context: { reason },
        error,
      })
    })
  }
  const onDestroyed = (): void => { cancelForRenderer('renderer_destroyed') }
  const onRenderProcessGone = (): void => { cancelForRenderer('render_process_gone') }
  const onReload = (): void => { cancelForRenderer('renderer_reload') }
  sender.once('destroyed', onDestroyed)
  sender.once('render-process-gone', onRenderProcessGone)
  sender.once('did-start-loading', onReload)
  unsubscribe = manager.onClosed(sessionId, clear)
}

export function registerImageEditorV3RasterExportIpc(
  options: RegisterRasterExportIpcOptions,
): void {
  registerIpcHandler(
    'imageEditorV3:rasterExport:start',
    parseImageEditorV3StartRasterExportPayload,
    (payload, event) => options.runRequest(
      'raster_export.start',
      payload.requestId,
      event.sender.id,
      async (signal) => {
        const presentation = formatPresentation(payload.format)
        const selection = await dialog.showSaveDialog(ownerFor(event), {
          defaultPath: exportFileName(payload.suggestedName, payload.documentRef, payload.format),
          filters: [{ name: presentation.label, extensions: presentation.acceptedExtensions }],
        })
        if (selection.canceled || !selection.filePath) {
          logger.info('用户取消栅格图片导出', {
            event: 'image_editor_v3.raster_export.dialog_cancelled',
            requestId: payload.requestId,
          })
          return { status: 'cancelled' as const }
        }
        const started = await options.manager.start({
          ownerId: event.sender.id,
          targetPath: normalizeSelectedPath(selection.filePath, payload.format),
          documentRef: payload.documentRef,
          revision: payload.revision,
          sourceFingerprint: payload.sourceFingerprint,
          format: payload.format,
          description: payload.description,
          tileSize: payload.tileSize,
          compressionLevel: payload.compressionLevel,
          quality: payload.quality,
          effort: payload.effort,
          signal,
        })
        monitorRendererLifetime(options.manager, event, started.sessionId)
        return {
          status: 'completed' as const,
          value: {
            sessionId: started.sessionId,
            documentRef: toDocumentRef(started.documentId),
            revision: started.revision,
            sourceFingerprint: started.sourceFingerprint,
            format: started.format,
          },
        }
      },
    ),
    options.guard,
  )
  registerIpcHandler(
    'imageEditorV3:rasterExport:startManaged',
    parseImageEditorV3StartRasterExportPayload,
    (payload, event) => options.runRequest(
      'raster_export.start_managed',
      payload.requestId,
      event.sender.id,
      async (signal) => {
        const started = await options.materializer.start({
          ownerId: event.sender.id,
          documentRef: payload.documentRef,
          revision: payload.revision,
          sourceFingerprint: payload.sourceFingerprint,
          format: payload.format,
          description: payload.description,
          tileSize: payload.tileSize,
          compressionLevel: payload.compressionLevel,
          quality: payload.quality,
          effort: payload.effort,
          signal,
        })
        monitorRendererLifetime(
          options.manager,
          event,
          started.sessionId,
          (ownerId, sessionId, reason) => options.materializer.cancel(ownerId, sessionId, reason),
        )
        return {
          sessionId: started.sessionId,
          documentRef: toDocumentRef(started.documentId),
          revision: started.revision,
          sourceFingerprint: started.sourceFingerprint,
          format: started.format,
        }
      },
    ),
    options.guard,
  )
  registerIpcHandler(
    'imageEditorV3:rasterExport:writeTile',
    parseImageEditorV3WriteRasterExportTilePayload,
    async (payload, event) => {
      await options.manager.writeTile(event.sender.id, payload.sessionId, payload.tile)
      return { written: true as const }
    },
    options.guard,
  )
  registerIpcHandler(
    'imageEditorV3:rasterExport:complete',
    parseImageEditorV3RasterExportSessionPayload,
    async (payload, event) => {
      if (options.materializer.has(payload.sessionId)) {
        throw new Error('Managed raster session requires managed completion')
      }
      const completed = await options.manager.complete(event.sender.id, payload.sessionId)
      const { documentId, ...result } = completed
      return {
        ...result,
        documentRef: toDocumentRef(documentId),
      }
    },
    options.guard,
  )
  registerIpcHandler(
    'imageEditorV3:rasterExport:completeManaged',
    parseImageEditorV3RasterExportSessionPayload,
    async (payload, event) => {
      const completed = await options.materializer.complete(event.sender.id, payload.sessionId)
      const { documentId, ...result } = completed
      return {
        ...result,
        documentRef: toDocumentRef(documentId),
        previewRef: completed.previewRef,
        mediaUrl: completed.mediaUrl,
      }
    },
    options.guard,
  )
  registerIpcHandler(
    'imageEditorV3:rasterExport:cancel',
    parseImageEditorV3RasterExportSessionPayload,
    async (payload, event) => ({ cancelled: options.materializer.has(payload.sessionId)
      ? await options.materializer.cancel(event.sender.id, payload.sessionId)
      : await options.manager.cancel(event.sender.id, payload.sessionId) }),
    options.guard,
  )
}
