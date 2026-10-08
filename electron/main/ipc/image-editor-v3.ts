import { BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type { ImageEditDocumentV3 } from '../../../src/core/imageEdit/v3/documentTypes'
import type {
  ImageEditorV3DocumentSnapshot,
} from '../../../src/platform/contracts/imageEditorV3'
import { getMainWindow } from '../window'
import { isTrustedMainRendererUrl } from '../security/main-renderer-url'
import { createMainLogger } from '../services/logging'
import { registerWorkRootBusyProbe } from '../services/work-root/busy-probes'
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
  parseImageEditorV3ListPayload,
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
import { registerImageEditorV3ImageDocumentIpc } from './image-editor-v3-package'
import path from 'node:path'
import { getProgramStoreDir } from '../services/appBasePaths'
import { getUserDataLayout } from '../services/appPaths'
import { getDocumentService, resolveContainerInternalFolder } from '../services/documents/runtime'
import {
  createImageEditorV3ResourceMediaUrl,
  imageEditorV3ResourceObjectPath,
} from '../services/image-editor-v3/resource-media-url'
import { ImageDocumentService, ImageDocumentWorkingCopyLinks } from '../services/image-editor-v3/image-document'
import { CanvasLayerPackageService } from '../services/image-editor-v3/canvas-layers/canvas-layer-packages'

export {
  parseImageEditorV3FastProxyPayload,
  parseImageEditorV3IngestSourcePayload,
  parseImageEditorV3LoadPayload,
  parseImageEditorV3DeleteIfRevisionPayload,
  parseImageEditorV3ForkPayload,
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
  imageDocuments: ImageDocumentService
  canvasLayers: CanvasLayerPackageService
}
let runtime: ImageEditorV3Runtime | undefined
// 图片导出写到用户选的位置（常在作品目录里），进行中不允许更换作品目录
registerWorkRootBusyProbe('image_raster_export', { reason: '还有图片正在导出', isBusy: () => runtime?.rasterExports.hasActiveSessions() ?? false })
const requestAdmission = new ImageEditorV3RequestAdmission()
const trackedSenders = new WeakMap<WebContents, () => void>()
function getRuntime(): ImageEditorV3Runtime {
  if (runtime) return runtime
  const paths = getImageEditorV3StoragePaths()
  const resources = new ContentAddressedResourceStore(paths.resourcesDir)
  const documents = new ImageEditDocumentRepository(paths.documentsDir)
  const sources = new SharpSourceProvider(resources)
  const rasterExports = new RasterExportSessionManager(documents, resources)
  const packages = new HenjiImagePackageCodec(resources, sources)
  runtime = {
    documents,
    resources,
    sources,
    packages,
    sourceIngestor: new ImageEditorV3SourceIngestor(resources, sources),
    brushTiles: new ImageEditBrushTileStoreV3(resources),
    rasterExports,
    managedRaster: new ManagedRasterMaterializer(
      rasterExports,
      documents,
      resources,
      paths.materializationsDir,
    ),
    // 图片文档（3.5）：.henjiimg 是正式文件，工作副本就是本仓库里同 ID 的文档；
    // 锁与通用文档仓库共用（程序目录 DocumentStore/locks），写回与改名、移动互斥。
    imageDocuments: new ImageDocumentService({
      documents,
      packages,
      links: new ImageDocumentWorkingCopyLinks(path.join(paths.rootDir, 'document-links')),
      catalog: {
        listDocuments: (query) => getDocumentService().listDocuments(query),
        listProjects: (query) => getDocumentService().listProjects(query),
        refreshIndex: () => getDocumentService().refreshIndex(),
        saveDocumentCover: (request) => getDocumentService().saveDocumentCover(request),
        layout: () => {
          const layout = getUserDataLayout()
          return { root: layout.root, locale: layout.locale }
        },
      },
      lockDirectory: path.join(getProgramStoreDir('documentStore'), 'locks'),
      logger: createMainLogger('main.image_editor_v3.image_document'),
      validateDocument: (document) => { validateSnapshotDocument(document) },
      resourceFilePath: imageEditorV3ResourceObjectPath,
      resourceMediaUrl: async (resourceId) => {
        const descriptor = await resources.describe(resourceId)
        return descriptor.mediaType ? createImageEditorV3ResourceMediaUrl(resourceId, descriptor.mediaType) : null
      },
    }),
    // 画布多图层节点的内嵌图片文档（3.4）：工作副本照旧在本仓库，写回时打包进画布所在容器的 .henji/
    canvasLayers: new CanvasLayerPackageService({
      documents,
      packages,
      linksDirectory: path.join(paths.rootDir, 'canvas-layer-links'),
      logger: createMainLogger('main.image_editor_v3.canvas_layers'),
      validateDocument: (document) => { validateSnapshotDocument(document) },
      resolveInternalFolder: resolveContainerInternalFolder,
      referencedByOtherCanvases: findCanvasLayersReferencedElsewhere,
    }),
  }
  // 图片文档工作副本回收（4.1）：运行时建好后在后台检查一次，不阻塞第一次请求；本次运行用过的文档一律跳过。
  const startedRuntime = runtime
  const pruneTimer = setTimeout(() => { void startedRuntime.imageDocuments.pruneWorkingCopies().catch(() => undefined) }, 30_000)
  pruneTimer.unref?.()
  return runtime
}
/**
 * 别的画布（含草稿、尚未打开的副本）内容里还提到的内嵌文档：按文档 ID 在内容里查找。
 * 找不到文件的画布读不了，跳过；读得到却读失败时抛错，调用方本次不清理。
 */
async function findCanvasLayersReferencedElsewhere(canvasId: string, documentIds: readonly string[]): Promise<Set<string>> {
  const service = getDocumentService()
  const referenced = new Set<string>()
  const canvases = await service.listDocuments({ kind: 'canvas', includeMissing: false })
  for (const canvas of canvases) {
    if (canvas.id === canvasId) continue
    const text = JSON.stringify((await service.readDocument({ id: canvas.id, path: canvas.path })).content)
    for (const documentId of documentIds) if (text.includes(documentId)) referenced.add(documentId)
    if (referenced.size === documentIds.length) break
  }
  return referenced
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

export function registerImageEditorV3Ipc(): void {
  const guard = assertTrustedMainRenderer
  registerImageEditorV3RasterExportIpc({
    manager: getRuntime().rasterExports,
    materializer: getRuntime().managedRaster,
    guard,
    runRequest,
  })
  registerImageEditorV3BrushTileIpc({ store: getRuntime().brushTiles, guard, runRequest })
  registerIpcHandler('imageEditorV3:document:list', parseImageEditorV3ListPayload, (payload, event) => (
    runRequest('document.list', payload.requestId, event.sender.id, async (signal) => {
      throwIfAborted(signal)
      const result = await getRuntime().documents.listReferences(payload.cursor, payload.limit)
      throwIfAborted(signal)
      // 图片文档（.henjiimg，3.5）的工作副本不在这里列出：它们按作品索引以文档身份出现。
      // 分页游标仍沿用未过滤的列表，过滤后的一页可能为空。
      const documentRefs = []
      for (const ref of result.documentRefs) {
        if (!await getRuntime().imageDocuments.isWorkingCopy(parseDocumentRef(ref))) documentRefs.push(ref)
      }
      return { documentRefs, nextCursor: result.nextCursor }
    })
  ), guard)
  registerIpcHandler('imageEditorV3:document:load', parseImageEditorV3LoadPayload, (payload, event) => (
    runRequest('document.load', payload.requestId, event.sender.id, async (signal) => {
      throwIfAborted(signal)
      try {
        const document = await getRuntime().documents.load(payload.documentRef)
        await assertHistoryResourceSizes(document.history)
        return await toSnapshot(document, signal)
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
    resources: getRuntime().resources,
    sources: getRuntime().sources,
    sourceIngestor: getRuntime().sourceIngestor,
    guard,
    runRequest,
    cancelRequest: (senderId, requestId) => requestAdmission.cancel(senderId, requestId),
  })
  registerImageEditorV3ImageDocumentIpc({
    imageDocuments: () => getRuntime().imageDocuments,
    canvasLayers: () => getRuntime().canvasLayers,
    guard,
    runRequest,
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
  const current = runtime
  runtime = undefined
  await current?.rasterExports.dispose()
}
