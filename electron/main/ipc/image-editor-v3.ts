import path from 'node:path'
import { BrowserWindow, dialog, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { getMainWindow } from '../window'
import { isTrustedMainRendererUrl } from '../security/main-renderer-url'
import { getDataRootDir, sanitizeFileStem } from '../services/image/path-utils'
import { createMainLogger } from '../services/logging'
import {
  ContentAddressedResourceStore,
  createImageEditSourceFingerprint,
  DocumentRevisionConflictError,
  HenjiImagePackageCodec,
  ImageEditBrushTileStoreV3,
  ImageEditDocumentRepository,
  ImageEditorV3SourceIngestor,
  RasterExportSessionManager,
  SharpSourceProvider,
  toDocumentRef,
  type ImageEditDocumentEnvelope,
  type ResourceDescriptor,
  type ResourceId,
  type SourceImageMetadata,
  collectPersistedImageEditHistoryResourcesV3,
} from '../services/image-editor-v3'
import { registerImageEditorV3RasterExportIpc } from './image-editor-v3-raster-export'
import { registerImageEditorV3BrushTileIpc } from './image-editor-v3-brush-tiles'
import {
  normalizeImageEditorV3Document,
  parseImageEditorV3BasePayload,
  parseImageEditorV3FastProxyPayload,
  parseImageEditorV3GarbageCollectPayload,
  parseImageEditorV3IngestSourcePayload,
  parseImageEditorV3LoadPayload,
  parseImageEditorV3PyramidPrewarmPayload,
  parseImageEditorV3ResourcePayload,
  parseImageEditorV3SavePackagePayload,
  parseImageEditorV3SavePayload,
  parseImageEditorV3TilePayload,
  type SaveDocumentPayload,
} from './image-editor-v3-payloads'
import { registerIpcHandler } from './registry'
import {
  estimateImageEditorV3ProxyRequestBytes,
  estimateImageEditorV3PyramidPrewarmBytes,
  estimateImageEditorV3TileRequestBytes,
  ImageEditorV3RequestAdmission,
} from './image-editor-v3-request-admission'

export {
  parseImageEditorV3FastProxyPayload,
  parseImageEditorV3IngestSourcePayload,
  parseImageEditorV3LoadPayload,
  parseImageEditorV3PyramidPrewarmPayload,
  parseImageEditorV3SavePayload,
  parseImageEditorV3TilePayload,
} from './image-editor-v3-payloads'
export {
  parseImageEditorV3PersistBrushTilesPayload,
  parseImageEditorV3ReadBrushTilesPayload,
} from './image-editor-v3-payloads'

const logger = createMainLogger('main.image_editor_v3.ipc')
interface ImageEditorV3Runtime {
  documents: ImageEditDocumentRepository; resources: ContentAddressedResourceStore
  sources: SharpSourceProvider; packages: HenjiImagePackageCodec
  sourceIngestor: ImageEditorV3SourceIngestor
  brushTiles: ImageEditBrushTileStoreV3
  rasterExports: RasterExportSessionManager
}
let runtime: ImageEditorV3Runtime | undefined
const requestAdmission = new ImageEditorV3RequestAdmission()
const trackedSenders = new WeakMap<WebContents, () => void>()
function getRuntime(): ImageEditorV3Runtime {
  if (runtime) return runtime
  const rootDir = path.join(getDataRootDir(), 'ImageEditorV3')
  const resources = new ContentAddressedResourceStore(path.join(rootDir, 'resources'))
  const documents = new ImageEditDocumentRepository(path.join(rootDir, 'documents'))
  const sources = new SharpSourceProvider(resources)
  runtime = {
    documents,
    resources,
    sources,
    packages: new HenjiImagePackageCodec(resources),
    sourceIngestor: new ImageEditorV3SourceIngestor(resources, sources),
    brushTiles: new ImageEditBrushTileStoreV3(resources),
    rasterExports: new RasterExportSessionManager(documents, resources),
  }
  return runtime
}
function trackRendererLifetime(sender: WebContents): void {
  if (trackedSenders.has(sender)) return
  const cleanup = (): void => {
    sender.off('destroyed', abortRequests)
    sender.off('render-process-gone', abortRequests)
    sender.off('did-start-loading', abortRequests)
    trackedSenders.delete(sender)
  }
  const abortRequests = (): void => {
    cleanup()
    requestAdmission.abortSender(sender.id)
  }
  sender.once('destroyed', abortRequests)
  sender.once('render-process-gone', abortRequests)
  sender.once('did-start-loading', abortRequests)
  trackedSenders.set(sender, cleanup)
}

function assertTrustedMainRenderer(event: IpcMainInvokeEvent): void {
  const owner = BrowserWindow.fromWebContents(event.sender)
  const mainWindow = getMainWindow()
  if (!owner || owner !== mainWindow || owner.isDestroyed() || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Untrusted image editor V3 IPC sender')
  }
  if (!isTrustedMainRendererUrl(event.senderFrame.url)) {
    throw new Error('Untrusted image editor V3 IPC origin')
  }
  trackRendererLifetime(event.sender)
}
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function toSnapshot(envelope: ImageEditDocumentEnvelope): Record<string, unknown> {
  const normalized = normalizeImageEditorV3Document(envelope.document)
  if (normalized.documentId !== envelope.documentId || normalized.revision !== envelope.revision) {
    throw new Error('Image editor V3 document body and envelope revisions differ')
  }
  return {
    documentRef: toDocumentRef(envelope.documentId),
    revision: envelope.revision,
    sourceFingerprint: createImageEditSourceFingerprint(envelope),
    previewRef: envelope.previewRef ?? null,
    resourceRefs: envelope.resourceRefs,
    history: envelope.history ?? null,
    document: normalized.document,
  }
}

function toReference(envelope: ImageEditDocumentEnvelope): Record<string, unknown> {
  const normalized = normalizeImageEditorV3Document(envelope.document)
  if (normalized.documentId !== envelope.documentId || normalized.revision !== envelope.revision) {
    throw new Error('Image editor V3 document body and envelope revisions differ')
  }
  return {
    documentRef: toDocumentRef(envelope.documentId),
    revision: envelope.revision,
    previewRef: envelope.previewRef ?? null,
  }
}

function toResource(descriptor: ResourceDescriptor): Record<string, unknown> {
  return { resourceRef: descriptor.id, byteLength: descriptor.byteLength, mediaType: descriptor.mediaType ?? null }
}

function toMetadata(metadata: SourceImageMetadata): Record<string, unknown> {
  return {
    resourceRef: metadata.resourceId,
    width: metadata.width,
    height: metadata.height,
    encodedWidth: metadata.encodedWidth,
    encodedHeight: metadata.encodedHeight,
    format: metadata.format ?? null,
    channels: metadata.channels ?? null,
    depth: metadata.depth ?? null,
    bitsPerSample: metadata.bitsPerSample,
    colorSpace: metadata.colorSpace ?? null,
    orientation: metadata.orientation,
    orientationApplied: metadata.orientationApplied,
    density: metadata.density ?? null,
    pages: metadata.pages ?? null,
    hasAlpha: metadata.hasAlpha,
    hasIccProfile: metadata.hasIccProfile,
    iccProfileResourceRef: metadata.iccProfileResourceId ?? null,
    cicp: metadata.cicp,
    hdr: metadata.hdr,
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  const error = new Error('Image editor request cancelled')
  error.name = 'AbortError'
  throw error
}

async function assertHistoryResourceSizes(
  history: ImageEditDocumentEnvelope['history'],
): Promise<void> {
  for (const resource of collectPersistedImageEditHistoryResourcesV3(history)) {
    if (resource.byteSize === null) continue
    const descriptor = await getRuntime().resources.describe(resource.resourceId as ResourceId)
    if (descriptor.byteLength !== resource.byteSize) {
      throw new Error(`History resource byte length mismatch: ${resource.resourceId}`)
    }
  }
}

async function runRequest<T>(
  operation: string,
  requestId: string,
  senderId: number,
  work: (signal: AbortSignal) => Promise<T>,
  estimatedBytes?: number,
): Promise<T> {
  const ticket = requestAdmission.admit(operation, requestId, senderId, estimatedBytes)
  logger.info('图片编辑 V3 请求开始', { event: `image_editor_v3.${operation}.start`, requestId })
  try {
    const result = await work(ticket.signal)
    logger.info('图片编辑 V3 请求完成', { event: `image_editor_v3.${operation}.completed`, requestId })
    return result
  } catch (error) {
    if (isAbort(error)) {
      logger.info('图片编辑 V3 请求已取消', { event: `image_editor_v3.${operation}.cancelled`, requestId })
    } else {
      logger.error('图片编辑 V3 请求失败', {
        event: `image_editor_v3.${operation}.failed`, requestId, error,
      })
    }
    throw error
  } finally {
    ticket.release()
  }
}

async function saveDocument(payload: SaveDocumentPayload): Promise<Record<string, unknown>> {
  const services = getRuntime()
  const refs = [...new Set([...payload.resourceRefs, ...(payload.previewRef ? [payload.previewRef] : [])])]
  // 校验资源存在后必须一直持有 lease，直到文档引用已原子落盘。否则 GC 可以在
  // `has()` 和 repository.save() 之间删除刚导入但尚未被文档引用的对象。
  const lease = await services.resources.acquireLease(refs)
  try {
    await assertHistoryResourceSizes(payload.history)
    let current: ImageEditDocumentEnvelope | null
    try {
      current = await services.documents.load(payload.documentId)
    } catch (error) {
      if (!isNotFound(error)) throw error
      current = null
    }
    if (!current) {
      if (payload.expectedRevision !== 0) {
        throw new DocumentRevisionConflictError(payload.documentId, payload.expectedRevision, 0)
      }
      const created = await services.documents.create({
        documentId: payload.documentId,
        revision: payload.revision,
        document: payload.document,
        history: payload.history,
        resourceRefs: payload.resourceRefs,
        previewRef: payload.previewRef,
      })
      return toReference(created)
    }
    if (payload.revision === current.revision && payload.expectedRevision === current.revision) {
      const unchanged = JSON.stringify(current.document) === JSON.stringify(payload.document)
        && JSON.stringify(current.history) === JSON.stringify(payload.history)
        && JSON.stringify(current.resourceRefs) === JSON.stringify(payload.resourceRefs)
        && current.previewRef === payload.previewRef
      if (unchanged) return toReference(current)
      if (JSON.stringify(current.document) !== JSON.stringify(payload.document)) {
        throw new Error('Document content changed without advancing revision')
      }
    }
    const saved = await services.documents.save({
      documentId: payload.documentId,
      expectedRevision: payload.expectedRevision,
      nextRevision: payload.revision,
      document: payload.document,
      history: payload.history,
      resourceRefs: payload.resourceRefs,
      previewRef: payload.previewRef,
    })
    return toReference(saved)
  } finally {
    await lease.release()
  }
}

async function persistImportedDocument(imported: ImageEditDocumentEnvelope): Promise<ImageEditDocumentEnvelope> {
  toSnapshot(imported)
  const documents = getRuntime().documents
  let current: ImageEditDocumentEnvelope | null
  try {
    current = await documents.load(imported.documentId)
  } catch (error) {
    if (!isNotFound(error)) throw error
    current = null
  }
  if (!current) {
    return documents.create({
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

function ownerFor(event: IpcMainInvokeEvent): BrowserWindow {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (!owner) throw new Error('Image editor window is unavailable')
  return owner
}

function packageFileName(raw: string | undefined, documentId: string): string {
  const stem = sanitizeFileStem(raw ?? documentId)
  return stem.toLowerCase().endsWith('.henjiimg') ? stem : `${stem}.henjiimg`
}

export function registerImageEditorV3Ipc(): void {
  const guard = assertTrustedMainRenderer
  registerImageEditorV3RasterExportIpc({ manager: getRuntime().rasterExports, guard, runRequest })
  registerImageEditorV3BrushTileIpc({ store: getRuntime().brushTiles, guard, runRequest })
  registerIpcHandler('imageEditorV3:document:load', parseImageEditorV3LoadPayload, (payload, event) => (
    runRequest('document.load', payload.requestId, event.sender.id, async (signal) => {
      throwIfAborted(signal)
      try {
        const document = await getRuntime().documents.load(payload.documentRef)
        await assertHistoryResourceSizes(document.history)
        return toSnapshot(document)
      }
      catch (error) { if (isNotFound(error)) return null; throw error }
    })
  ), guard)
  registerIpcHandler('imageEditorV3:document:save', parseImageEditorV3SavePayload, (payload, event) => (
    runRequest('document.save', payload.requestId, event.sender.id, (signal) => {
      throwIfAborted(signal)
      return saveDocument(payload)
    })
  ), guard)
  registerIpcHandler('imageEditorV3:source:import', parseImageEditorV3BasePayload, (payload, event) => (
    runRequest('source.import', payload.requestId, event.sender.id, async (signal) => {
      const selection = await dialog.showOpenDialog(ownerFor(event), {
        properties: ['openFile'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'avif'] }],
      })
      if (selection.canceled || !selection.filePaths[0]) {
        logger.info('用户取消导入图片源', {
          event: 'image_editor_v3.source.import.dialog_cancelled', requestId: payload.requestId,
        })
        return { status: 'cancelled' as const }
      }
      throwIfAborted(signal)
      const imported = await getRuntime().sourceIngestor.ingest({
        kind: 'local-path',
        filePath: selection.filePaths[0],
      }, signal)
      return { status: 'completed' as const, value: {
        resource: toResource(imported.resource),
        metadata: toMetadata(imported.metadata),
      } }
    })
  ), guard)
  registerIpcHandler('imageEditorV3:source:ingest', parseImageEditorV3IngestSourcePayload, (payload, event) => (
    runRequest('source.ingest', payload.requestId, event.sender.id, async (signal) => {
      const imported = await getRuntime().sourceIngestor.ingest(payload.source, signal)
      return { resource: toResource(imported.resource), metadata: toMetadata(imported.metadata) }
    })
  ), guard)
  registerIpcHandler('imageEditorV3:source:metadata', parseImageEditorV3ResourcePayload, (payload, event) => (
    runRequest('source.metadata', payload.requestId, event.sender.id, async (signal) => (
      toMetadata(await getRuntime().sources.readMetadata(payload.resourceRef, signal))
    ))
  ), guard)
  registerIpcHandler('imageEditorV3:source:pyramid', parseImageEditorV3ResourcePayload, (payload, event) => (
    runRequest('source.pyramid', payload.requestId, event.sender.id, (signal) => (
      getRuntime().sources.describePyramid(payload.resourceRef, signal)
    ))
  ), guard)
  registerIpcHandler('imageEditorV3:source:pyramidPrewarm', parseImageEditorV3PyramidPrewarmPayload, (payload, event) => (
    runRequest('source.pyramid_prewarm', payload.requestId, event.sender.id, (signal) => (
      getRuntime().sources.prewarmPyramid({
        resourceId: payload.resourceRef, minimumMip: payload.minimumMip,
        maximumMip: payload.maximumMip, tileBudget: payload.tileBudget,
        bitDepth: payload.bitDepth, signal,
      })
    ), estimateImageEditorV3PyramidPrewarmBytes(payload.bitDepth))
  ), guard)
  registerIpcHandler('imageEditorV3:source:fastProxy', parseImageEditorV3FastProxyPayload, (payload, event) => (
    runRequest('source.fast_proxy', payload.requestId, event.sender.id, async (signal) => {
      const proxy = await getRuntime().sources.readFastProxy(payload.resourceRef, payload.maxDimension, signal)
      return { resourceRef: proxy.resourceId, width: proxy.width, height: proxy.height, mediaType: 'image/webp', bytes: toArrayBuffer(proxy.bytes) }
    }), estimateImageEditorV3ProxyRequestBytes(payload.maxDimension)
  ), guard)
  registerIpcHandler('imageEditorV3:source:tile', parseImageEditorV3TilePayload, (payload, event) => (
    runRequest('source.tile', payload.requestId, event.sender.id, async (signal) => {
      const tile = await getRuntime().sources.readTile({
        resourceId: payload.resourceRef, mip: payload.mip, tileX: payload.tileX, tileY: payload.tileY,
        halo: payload.halo, bitDepth: payload.bitDepth, signal,
      })
      const { resourceId, pixels, ...metadata } = tile
      return { ...metadata, resourceRef: resourceId, pixels: toArrayBuffer(pixels) }
    }), estimateImageEditorV3TileRequestBytes(payload)
  ), guard)
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
      const imported = await getRuntime().packages.import(selection.filePaths[0], { signal })
      let document: ImageEditDocumentEnvelope
      try {
        document = await persistImportedDocument(imported.manifest.document)
      } finally {
        await imported.resourceLease.release()
      }
      return { status: 'completed' as const, value: {
        snapshot: toSnapshot(document),
        resources: imported.resources.map(toResource),
        thumbnail: imported.thumbnail && imported.manifest.thumbnail
          ? { bytes: toArrayBuffer(imported.thumbnail), mediaType: imported.manifest.thumbnail.mediaType }
          : null,
      } }
    })
  ), guard)
  registerIpcHandler('imageEditorV3:package:saveAs', parseImageEditorV3SavePackagePayload, (payload, event) => (
    runRequest('package.save_as', payload.requestId, event.sender.id, async (signal) => {
      const document = await getRuntime().documents.load(payload.documentRef)
      await assertHistoryResourceSizes(document.history)
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
      await getRuntime().packages.export({ targetPath, document, signal })
      return { status: 'completed' as const, value: {
        outputRef: `henjiimg:${document.documentId}@${document.revision}`,
        documentRef: toDocumentRef(document.documentId), revision: document.revision,
      } }
    })
  ), guard)
  registerIpcHandler('imageEditorV3:resource:collectGarbage', parseImageEditorV3GarbageCollectPayload, (payload, event) => (
    runRequest('resource.collect_garbage', payload.requestId, event.sender.id, async () => {
      const live = new Set<ResourceId>(payload.retainedResourceRefs)
      for (const document of await getRuntime().documents.list()) {
        for (const resourceRef of document.resourceRefs) live.add(resourceRef)
        if (document.previewRef) live.add(document.previewRef)
      }
      const result = await getRuntime().resources.garbageCollect(live)
      return { deletedResourceRefs: result.deleted, reclaimedBytes: result.reclaimedBytes }
    })
  ), guard)
  registerIpcHandler('imageEditorV3:request:cancel', parseImageEditorV3BasePayload, (payload, event) => {
    return { cancelled: requestAdmission.cancel(event.sender.id, payload.requestId) }
  }, guard)
}

export async function disposeImageEditorV3Ipc(): Promise<void> {
  requestAdmission.abortAll()
  const current = runtime
  runtime = undefined
  await current?.rasterExports.dispose()
}
