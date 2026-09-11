import { BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type { ImageEditDocumentV3 } from '../../../src/core/imageEdit/v3/documentTypes'
import type {
  ImageEditorV3DocumentSnapshot,
} from '../../../src/platform/contracts/imageEditorV3'
import { getMainWindow } from '../window'
import { isTrustedMainRendererUrl } from '../security/main-renderer-url'
import { createMainLogger } from '../services/logging'
import { AgentOperationStore } from '../services/agent-runtime/persistence/operation-store'
import { getDb } from '../services/db'
import { imageEditPersistenceDigest } from '../services/image-editor-v3/document-repository'
import type { ApplicationPersistenceReceiptRecord } from '../../../src/core/application-control/persistenceCorrelation'
import {
  ContentAddressedResourceStore,
  createImageEditSourceFingerprint,
  DocumentRevisionConflictError,
  HenjiImagePackageCodec,
  ImageEditBrushTileStoreV3,
  ImageEditDocumentRepository,
  ImageEditorV3SourceIngestor,
  ManagedRasterMaterializer,
  parseDocumentRef,
  RasterExportSessionManager,
  SharpSourceProvider,
  toDocumentRef,
  type ImageEditDocumentEnvelope,
  type ResourceId,
  collectPersistedImageEditHistoryResourcesV3,
  getImageEditorV3StoragePaths,
} from '../services/image-editor-v3'
import { registerImageEditorV3RasterExportIpc } from './image-editor-v3-raster-export'
import { registerImageEditorV3BrushTileIpc } from './image-editor-v3-brush-tiles'
import {
  normalizeImageEditorV3Document,
  parseImageEditorV3BasePayload,
  parseImageEditorV3GarbageCollectPayload,
  parseImageEditorV3DeleteIfRevisionPayload,
  parseImageEditorV3ForkPayload,
  parseImageEditorV3LoadPayload,
  parseImageEditorV3SavePayload,
  type SaveDocumentPayload,
} from './image-editor-v3-payloads'
import { registerIpcHandler } from './registry'
import { ImageEditorV3RequestAdmission } from './image-editor-v3-request-admission'
import { registerImageEditorV3SourceIpc } from './image-editor-v3-source'
import { describeImageEditorV3DocumentResources } from '../services/image-editor-v3/snapshot-resources'
export { describeImageEditorV3SnapshotResources } from '../services/image-editor-v3/snapshot-resources'
import {
  abandonImageEditorV3PendingPackageImports,
  disposeImageEditorV3PendingPackageImports,
  registerImageEditorV3PackageIpc,
} from './image-editor-v3-package'

export {
  parseImageEditorV3FastProxyPayload,
  parseImageEditorV3IngestSourcePayload,
  parseImageEditorV3LoadPayload,
  parseImageEditorV3DeleteIfRevisionPayload,
  parseImageEditorV3ForkPayload,
  parseImageEditorV3RelinkPackageExternalSourcePayload,
  parseImageEditorV3SavePayload,
  parseImageEditorV3TilePayload,
} from './image-editor-v3-payloads'
export {
  parseImageEditorV3PyramidPrewarmPayload,
  parseImageEditorV3TileBatchPayload,
} from './image-editor-v3-tile-payloads'
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
  managedRaster: ManagedRasterMaterializer
}
let runtime: ImageEditorV3Runtime | undefined
const requestAdmission = new ImageEditorV3RequestAdmission()
const trackedSenders = new WeakMap<WebContents, () => void>()
function getRuntime(): ImageEditorV3Runtime {
  if (runtime) return runtime
  const paths = getImageEditorV3StoragePaths()
  const resources = new ContentAddressedResourceStore(paths.resourcesDir)
  const documents = new ImageEditDocumentRepository(paths.documentsDir, {
    confirmOperationReceipt: (receipt) => new AgentOperationStore(getDb()).confirmFilePersistence(receipt),
  })
  const sources = new SharpSourceProvider(resources)
  const rasterExports = new RasterExportSessionManager(documents, resources)
  runtime = {
    documents,
    resources,
    sources,
    packages: new HenjiImagePackageCodec(resources, sources),
    sourceIngestor: new ImageEditorV3SourceIngestor(resources, sources),
    brushTiles: new ImageEditBrushTileStoreV3(resources),
    rasterExports,
    managedRaster: new ManagedRasterMaterializer(
      rasterExports,
      documents,
      resources,
      paths.materializationsDir,
    ),
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
    void abandonImageEditorV3PendingPackageImports(sender.id)
  }
  sender.once('destroyed', abortRequests)
  sender.once('render-process-gone', abortRequests)
  sender.once('did-start-loading', abortRequests)
  trackedSenders.set(sender, cleanup)
}

function assertTrustedMainRenderer(event: IpcMainEvent | IpcMainInvokeEvent): void {
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
function validateSnapshotDocument(envelope: ImageEditDocumentEnvelope): ImageEditDocumentV3 {
  const normalized = normalizeImageEditorV3Document(envelope.document)
  if (normalized.documentId !== envelope.documentId || normalized.revision !== envelope.revision) {
    throw new Error('Image editor V3 document body and envelope revisions differ')
  }
  return normalized.document as ImageEditDocumentV3
}

async function toSnapshot(
  envelope: ImageEditDocumentEnvelope,
  signal: AbortSignal,
): Promise<ImageEditorV3DocumentSnapshot> {
  const document = validateSnapshotDocument(envelope)
  return {
    documentRef: toDocumentRef(envelope.documentId) as ImageEditorV3DocumentSnapshot['documentRef'],
    revision: envelope.revision,
    sourceFingerprint: createImageEditSourceFingerprint(envelope) as ImageEditorV3DocumentSnapshot['sourceFingerprint'],
    previewRef: envelope.previewRef ?? null,
    resourceRefs: envelope.resourceRefs,
    resources: await describeImageEditorV3DocumentResources(
      document,
      envelope.history,
      envelope.resourceRefs,
      (resourceRef) => getRuntime().resources.describe(resourceRef),
      getRuntime().brushTiles,
      signal,
    ),
    history: envelope.history ?? null,
    document,
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

async function saveDocument(payload: SaveDocumentPayload, senderId: number): Promise<Record<string, unknown>> {
  const services = getRuntime()
  const operationCorrelation = payload.operationCorrelation
  const operations = operationCorrelation ? new AgentOperationStore(getDb()) : undefined
  if (operationCorrelation) {
    operations!.assertPersistenceOwner(operationCorrelation.operationId, senderId)
    const prefix = `v3:${encodeURIComponent(payload.documentId)}`
    if (operationCorrelation.targets.some((ref) => (!ref.kind.startsWith('image_edit.') && ref.kind !== 'image_mark.annotation')
      || (ref.id !== prefix && !ref.id.startsWith(`${prefix}:`)))) throw new Error('OPERATION_PERSISTENCE_TARGET_INVALID')
  }
  const prepareOperationReceipt = operations ? (receipt: ApplicationPersistenceReceiptRecord) => operations.prepareFilePersistence(
    { operationId: receipt.operationId, boundaryId: receipt.boundaryId, targets: receipt.targets },
    receipt.storageTarget, receipt.digest, senderId) : undefined
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
    if (current) {
      services.documents.confirmPendingOperations(current)
      const confirmed = operationCorrelation && operations!.get(operationCorrelation.operationId)?.persistenceReceipts
        .find((receipt) => receipt.boundaryId === operationCorrelation.boundaryId)
      if (confirmed) {
        if (confirmed.digest !== imageEditPersistenceDigest(payload) || confirmed.digest !== imageEditPersistenceDigest(current)) {
          throw new Error('OPERATION_PERSISTENCE_CONFLICT')
        }
        return toReference(current)
      }
    }
    if (!current) {
      if (payload.expectedRevision !== 0) {
        throw new DocumentRevisionConflictError(payload.documentId, payload.expectedRevision, 0)
      }
      const created = await services.documents.create({
        operationCorrelation, prepareOperationReceipt,
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
      if (unchanged && !operationCorrelation) return toReference(current)
      if (JSON.stringify(current.document) !== JSON.stringify(payload.document)) {
        throw new Error('Document content changed without advancing revision')
      }
    }
    const saved = await services.documents.save({
      operationCorrelation, prepareOperationReceipt,
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

export function registerImageEditorV3Ipc(): void {
  const guard = assertTrustedMainRenderer
  registerImageEditorV3RasterExportIpc({
    manager: getRuntime().rasterExports,
    materializer: getRuntime().managedRaster,
    guard,
    runRequest,
  })
  registerImageEditorV3BrushTileIpc({ store: getRuntime().brushTiles, guard, runRequest })
  registerIpcHandler('imageEditorV3:document:load', parseImageEditorV3LoadPayload, (payload, event) => (
    runRequest('document.load', payload.requestId, event.sender.id, async (signal) => {
      throwIfAborted(signal)
      try {
        const document = await getRuntime().documents.load(payload.documentRef)
        getRuntime().documents.confirmPendingOperations(document)
        await assertHistoryResourceSizes(document.history)
        return await toSnapshot(document, signal)
      }
      catch (error) { if (isNotFound(error)) return null; throw error }
    })
  ), guard)
  registerIpcHandler('imageEditorV3:document:save', parseImageEditorV3SavePayload, (payload, event) => (
    runRequest('document.save', payload.requestId, event.sender.id, (signal) => {
      throwIfAborted(signal)
      return saveDocument(payload, event.sender.id)
    })
  ), guard)
  registerIpcHandler(
    'imageEditorV3:document:deleteIfRevision',
    parseImageEditorV3DeleteIfRevisionPayload,
    (payload, event) => runRequest(
      'document.delete_if_revision',
      payload.requestId,
      event.sender.id,
      async (signal) => {
        throwIfAborted(signal)
        const deleted = await getRuntime().documents.deleteIfRevision(
          payload.documentRef,
          payload.expectedRevision,
        )
        throwIfAborted(signal)
        return { deleted }
      },
    ),
    guard,
  )
  registerIpcHandler(
    'imageEditorV3:document:fork',
    parseImageEditorV3ForkPayload,
    (payload, event) => runRequest(
      'document.fork',
      payload.requestId,
      event.sender.id,
      async (signal) => {
        throwIfAborted(signal)
        const targetDocumentId = parseDocumentRef(payload.targetDocumentRef)
        const forked = await getRuntime().documents.fork({
          sourceDocumentRef: payload.sourceDocumentRef,
          expectedRevision: payload.expectedRevision,
          targetDocumentId,
        })
        throwIfAborted(signal)
        return toReference(forked)
      },
    ),
    guard,
  )
  registerImageEditorV3SourceIpc({
    sources: getRuntime().sources,
    sourceIngestor: getRuntime().sourceIngestor,
    guard,
    runRequest,
    cancelRequest: (senderId, requestId) => requestAdmission.cancel(senderId, requestId),
  })
  registerImageEditorV3PackageIpc({
    documents: getRuntime().documents,
    packages: getRuntime().packages,
    guard,
    runRequest,
    toSnapshot,
    assertHistoryResourceSizes,
    validateSnapshotDocument: (document) => { validateSnapshotDocument(document) },
  })
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
  await disposeImageEditorV3PendingPackageImports()
  const current = runtime
  runtime = undefined
  await current?.rasterExports.dispose()
}
