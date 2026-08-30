import { createLogger } from '@/core/logging'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type {
  ImageEditBrushResourceReferenceV3,
  ImageEditBrushTileV3,
  PersistedImageEditBrushTileV3,
} from '@/core/imageEdit/v3/brush/contracts'
import {
  createFloat32MaskTile,
  createFloat32PremultipliedRgbaTile,
} from '@/core/imageEdit/v3/effects/contracts'
import { decodeImageEditCommandHistorySnapshotV3 } from '@/core/imageEdit/v3/commandHistoryCodec'
import { collectImageEditJsonResourceIdsV3 } from '@/core/imageEdit/v3/resourceReferences'
import type {
  ImageEditDocumentReferenceV3,
  ImageEditDocumentRepositoryV3,
  ImageEditDocumentSnapshotV3,
  ImageEditSaveDocumentOptionsV3,
} from '@/core/imageEdit/v3/serviceContracts'
import type {
  ImageEditorV3DocumentRef,
  ImageEditorV3LoadedBrushTile,
  ImageEditorV3Platform,
  ImageEditorV3ResourceRef,
} from '@/platform/contracts/imageEditorV3'
import { getPlatform } from '@/platform/runtime'

const logger = createLogger('commands.image_editor_v3')
const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const RESOURCE_REF_PATTERN = /^sha256:[a-f0-9]{64}$/

function abortError(): Error {
  const error = new Error('图片编辑请求已取消')
  error.name = 'AbortError'
  return error
}

export function createImageEditorV3RequestId(operation: string): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return `image-editor-v3:${operation}:${suffix}`
}

function toDocumentRef(documentIdOrRef: string): ImageEditorV3DocumentRef {
  if (documentIdOrRef.startsWith('image-edit-v3:')) return documentIdOrRef as ImageEditorV3DocumentRef
  if (!DOCUMENT_ID_PATTERN.test(documentIdOrRef)) throw new Error('图片编辑文档 ID 无效')
  return `image-edit-v3:${documentIdOrRef}`
}

function toResourceRef(value: string): ImageEditorV3ResourceRef {
  if (!RESOURCE_REF_PATTERN.test(value)) throw new Error(`图片编辑资源引用无效：${value}`)
  return value as ImageEditorV3ResourceRef
}

export function collectImageEditorV3ResourceRefs(
  document: ImageEditDocumentV3,
  previewRef?: string | null,
  historyResourceIds: readonly string[] = [],
): ImageEditorV3ResourceRef[] {
  return collectImageEditJsonResourceIdsV3(document, [
    ...(previewRef ? [toResourceRef(previewRef)] : []),
    ...historyResourceIds.map(toResourceRef),
  ]) as ImageEditorV3ResourceRef[]
}

function collectHistoryResourceIds(
  value: ImageEditSaveDocumentOptionsV3['history'],
): string[] {
  if (!value) return []
  const history = decodeImageEditCommandHistorySnapshotV3(value).snapshot
  return [...new Set(
    [...history.undo, ...history.redo]
      .flatMap((entry) => entry.resources.map((resource) => resource.resourceId)),
  )].sort()
}

async function runCancellable<T>(
  requestId: string,
  signal: AbortSignal | undefined,
  operation: (platform: ImageEditorV3Platform) => Promise<T>,
): Promise<T> {
  if (signal?.aborted) throw abortError()
  const platform = getPlatform().imageEditorV3
  const onAbort = (): void => {
    void platform.cancelRequest(requestId).catch((error: unknown) => {
      logger.warn('图片编辑取消请求发送失败', {
        event: 'image_editor_v3.cancel.invoke_failed',
        requestId,
        context: { error: error instanceof Error ? error.message : String(error) },
      })
    })
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    return await operation(platform)
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

export function loadImageEditorV3Document(
  request: Parameters<ImageEditorV3Platform['loadDocument']>[0],
  signal?: AbortSignal,
): ReturnType<ImageEditorV3Platform['loadDocument']> {
  return runCancellable(request.requestId, signal, (platform) => platform.loadDocument(request))
}

export function saveImageEditorV3Document(
  request: Parameters<ImageEditorV3Platform['saveDocument']>[0],
  signal?: AbortSignal,
): ReturnType<ImageEditorV3Platform['saveDocument']> {
  return runCancellable(request.requestId, signal, (platform) => platform.saveDocument(request))
}

export function importImageEditorV3Source(
  request: Parameters<ImageEditorV3Platform['importSource']>[0],
  signal?: AbortSignal,
): ReturnType<ImageEditorV3Platform['importSource']> {
  return runCancellable(request.requestId, signal, (platform) => platform.importSource(request))
}

export function ingestImageEditorV3Source(
  request: Parameters<ImageEditorV3Platform['ingestSource']>[0],
  signal?: AbortSignal,
): ReturnType<ImageEditorV3Platform['ingestSource']> {
  return runCancellable(request.requestId, signal, (platform) => platform.ingestSource(request))
}

export function readImageEditorV3SourceMetadata(
  request: Parameters<ImageEditorV3Platform['readSourceMetadata']>[0],
  signal?: AbortSignal,
): ReturnType<ImageEditorV3Platform['readSourceMetadata']> {
  return runCancellable(request.requestId, signal, (platform) => platform.readSourceMetadata(request))
}

export function describeImageEditorV3SourcePyramid(
  request: Parameters<ImageEditorV3Platform['describeSourcePyramid']>[0],
  signal?: AbortSignal,
): ReturnType<ImageEditorV3Platform['describeSourcePyramid']> {
  return runCancellable(request.requestId, signal, (platform) => platform.describeSourcePyramid(request))
}

export function readImageEditorV3FastProxy(
  request: Parameters<ImageEditorV3Platform['readFastProxy']>[0],
  signal?: AbortSignal,
): ReturnType<ImageEditorV3Platform['readFastProxy']> {
  return runCancellable(request.requestId, signal, (platform) => platform.readFastProxy(request))
}

export function readImageEditorV3SourceTile(
  request: Parameters<ImageEditorV3Platform['readSourceTile']>[0],
  signal?: AbortSignal,
): ReturnType<ImageEditorV3Platform['readSourceTile']> {
  return runCancellable(request.requestId, signal, (platform) => platform.readSourceTile(request))
}

function brushTileDataBuffer(tile: ImageEditBrushTileV3): ArrayBuffer {
  return new Float32Array(tile.data).buffer
}

function deserializeBrushTile(value: ImageEditorV3LoadedBrushTile['tile']): ImageEditBrushTileV3 {
  const channels = value.storage === 'rgba-float32' ? 4 : 1
  const expectedBytes = value.width * value.height * channels * Float32Array.BYTES_PER_ELEMENT
  if (!(value.data instanceof ArrayBuffer) || value.data.byteLength !== expectedBytes) {
    throw new Error('图片编辑画笔瓦片数据长度无效')
  }
  const data = new Float32Array(value.data.slice(0))
  if (value.storage === 'mask-float32') {
    return createFloat32MaskTile(value.width, value.height, data)
  }
  return createFloat32PremultipliedRgbaTile(
    value.width,
    value.height,
    value.colorDomain,
    data,
    value.workingSpace,
    value.transferFunction,
    value.referenceWhiteNits,
  )
}

export function persistImageEditorV3BrushTiles(
  request: {
    requestId: string
    tiles: ReadonlyArray<{ tileKey: string; tile: ImageEditBrushTileV3 }>
  },
  signal?: AbortSignal,
): Promise<{ tiles: PersistedImageEditBrushTileV3[] }> {
  return runCancellable(request.requestId, signal, async (platform) => {
    const result = await platform.persistBrushTiles({
      requestId: request.requestId,
      tiles: request.tiles.map((item) => ({
        tileKey: item.tileKey,
        tile: { ...item.tile, data: brushTileDataBuffer(item.tile) },
      })),
    })
    return {
      tiles: result.tiles.map((item) => ({
        tileKey: item.tileKey,
        resourceId: item.resource.resourceRef,
        byteSize: item.resource.byteSize,
      })),
    }
  })
}

export function readImageEditorV3BrushTiles(
  request: {
    requestId: string
    tiles: ReadonlyArray<{
      tileKey: string
      resource: ImageEditBrushResourceReferenceV3
    }>
  },
  signal?: AbortSignal,
): Promise<{ tiles: Array<{ tileKey: string; tile: ImageEditBrushTileV3 }> }> {
  return runCancellable(request.requestId, signal, async (platform) => {
    const result = await platform.readBrushTiles({
      requestId: request.requestId,
      tiles: request.tiles.map((item) => ({
        tileKey: item.tileKey,
        resource: {
          resourceRef: toResourceRef(item.resource.resourceId),
          byteSize: item.resource.byteSize,
        },
      })),
    })
    return {
      tiles: result.tiles.map((item) => ({
        tileKey: item.tileKey,
        tile: deserializeBrushTile(item.tile),
      })),
    }
  })
}

export function openImageEditorV3Package(
  request: Parameters<ImageEditorV3Platform['openPackage']>[0],
  signal?: AbortSignal,
): ReturnType<ImageEditorV3Platform['openPackage']> {
  return runCancellable(request.requestId, signal, (platform) => platform.openPackage(request))
}

export function saveImageEditorV3PackageAs(
  request: Parameters<ImageEditorV3Platform['savePackageAs']>[0],
  signal?: AbortSignal,
): ReturnType<ImageEditorV3Platform['savePackageAs']> {
  return runCancellable(request.requestId, signal, (platform) => platform.savePackageAs(request))
}

export function cancelImageEditorV3Request(requestId: string): Promise<{ cancelled: boolean }> {
  return getPlatform().imageEditorV3.cancelRequest(requestId)
}

interface PendingAutosave {
  document: ImageEditDocumentV3
  expectedRevision: number
  previewRef: string | null
  history: ImageEditSaveDocumentOptionsV3['history']
}

interface AutosaveState {
  timer?: ReturnType<typeof setTimeout>
  pending?: PendingAutosave
  activeRequestId?: string
  inFlight?: Promise<void>
  retryCount?: number
}

/** PAL-backed repository used by the command bus; no local path crosses this boundary. */
export class ImageEditorV3CommandRepository implements ImageEditDocumentRepositoryV3 {
  private readonly autosaves = new Map<string, AutosaveState>()

  async load(documentId: string, signal?: AbortSignal): Promise<ImageEditDocumentSnapshotV3 | null> {
    const requestId = createImageEditorV3RequestId('document-load')
    const snapshot = await loadImageEditorV3Document({
      requestId,
      documentRef: toDocumentRef(documentId),
    }, signal)
    if (!snapshot) return null
    return {
      documentId: snapshot.document.id,
      revision: snapshot.revision,
      previewRef: snapshot.previewRef,
      document: snapshot.document,
      history: snapshot.history,
    }
  }

  async save(
    document: ImageEditDocumentV3,
    options: ImageEditSaveDocumentOptionsV3,
  ): Promise<ImageEditDocumentReferenceV3> {
    const requestId = createImageEditorV3RequestId('document-save')
    const saved = await saveImageEditorV3Document({
      requestId,
      document,
      expectedRevision: options.expectedRevision,
      history: options.history ?? null,
      resourceRefs: collectImageEditorV3ResourceRefs(
        document,
        options.previewRef,
        collectHistoryResourceIds(options.history),
      ),
      previewRef: options.previewRef ? toResourceRef(options.previewRef) : null,
    }, options.signal)
    return {
      documentId: document.id,
      revision: saved.revision,
      previewRef: saved.previewRef,
    }
  }

  scheduleAutosave(document: ImageEditDocumentV3, options: ImageEditSaveDocumentOptionsV3): void {
    const state = this.autosaves.get(document.id) ?? {}
    if (state.timer) clearTimeout(state.timer)
    state.pending = {
      document,
      expectedRevision: state.pending?.expectedRevision ?? options.expectedRevision,
      previewRef: options.previewRef ?? null,
      history: options.history ?? null,
    }
    state.timer = setTimeout(() => {
      state.timer = undefined
      void this.flushAutosave(document.id, state)
    }, 500)
    this.autosaves.set(document.id, state)
  }

  cancelAutosave(documentId: string): void {
    const state = this.autosaves.get(documentId)
    if (!state) return
    if (state.timer) clearTimeout(state.timer)
    state.pending = undefined
    if (state.activeRequestId) {
      const requestId = state.activeRequestId
      void getPlatform().imageEditorV3.cancelRequest(requestId).catch((error: unknown) => {
        logger.warn('图片编辑自动保存取消请求发送失败', {
          event: 'image_editor_v3.autosave.cancel_failed',
          requestId,
          context: { error: error instanceof Error ? error.message : String(error) },
        })
      })
    }
    if (!state.inFlight) this.autosaves.delete(documentId)
  }

  async collectGarbage(_documentId: string, retainedResourceIds: readonly string[]): Promise<void> {
    const requestId = createImageEditorV3RequestId('resource-gc')
    await runCancellable(requestId, undefined, (platform) => platform.collectGarbage({
      requestId,
      retainedResourceRefs: retainedResourceIds.map(toResourceRef),
    }))
  }

  private async flushAutosave(documentId: string, state: AutosaveState): Promise<void> {
    if (state.inFlight) return
    const pending = state.pending
    if (!pending) return
    state.pending = undefined
    const requestId = createImageEditorV3RequestId('autosave')
    state.activeRequestId = requestId
    let failed = false
    state.inFlight = saveImageEditorV3Document({
      requestId,
      document: pending.document,
      expectedRevision: pending.expectedRevision,
      history: pending.history ?? null,
      resourceRefs: collectImageEditorV3ResourceRefs(
        pending.document,
        pending.previewRef,
        collectHistoryResourceIds(pending.history),
      ),
      previewRef: pending.previewRef ? toResourceRef(pending.previewRef) : null,
    }).then(() => {
      state.retryCount = 0
    }).catch((error: unknown) => {
      failed = true
      state.retryCount = (state.retryCount ?? 0) + 1
      const newer = state.pending
      state.pending = newer
        ? { ...newer, expectedRevision: pending.expectedRevision }
        : pending
      logger.error('图片编辑自动保存失败', error, {
        event: 'image_editor_v3.autosave.failed',
        requestId,
        context: { documentId, revision: pending.document.revision },
      })
    }).finally(() => {
      state.activeRequestId = undefined
      state.inFlight = undefined
      if (!state.pending) {
        this.autosaves.delete(documentId)
      } else if (failed) {
        const delay = Math.min(30_000, 500 * 2 ** Math.min(6, (state.retryCount ?? 1) - 1))
        state.timer = setTimeout(() => {
          state.timer = undefined
          void this.flushAutosave(documentId, state)
        }, delay)
      } else {
        void this.flushAutosave(documentId, state)
      }
    })
    await state.inFlight
  }
}
