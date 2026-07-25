/// <reference lib="webworker" />

import { WorkerWebGpuRuntime } from './webgpuRuntime'
import type {
  ImageEditWorkerErrorCode,
  ImageEditWorkerEvent,
  ImageEditWorkerExportRequest,
  ImageEditWorkerPreviewRequest,
  ImageEditWorkerRequest,
} from './protocol'
import { withImageEditWorkerExecutionCapabilities } from './protocol'

const workerScope = self as DedicatedWorkerGlobalScope
const runtime = new WorkerWebGpuRuntime()
const cancelledRequestIds = new Set<string>()
let latestPreviewRevision = -1
let renderQueue = Promise.resolve()

runtime.onDeviceLost((reason) => {
  postEvent({
    type: 'device-lost',
    reason,
    recoverable: true,
  })
})

workerScope.onmessage = (message: MessageEvent<ImageEditWorkerRequest>): void => {
  const request = message.data
  switch (request.type) {
    case 'initialize':
      enqueue(async () => {
        const capabilities = await runtime.initialize()
        postEvent({
          type: 'capabilities',
          requestId: request.requestId,
          capabilities: withImageEditWorkerExecutionCapabilities(capabilities),
        })
      })
      return
    case 'preview':
      latestPreviewRevision = Math.max(latestPreviewRevision, request.revision)
      enqueue(() => handlePreview(request))
      return
    case 'export':
      enqueue(() => handleExport(request))
      return
    case 'cancel':
      cancelledRequestIds.add(request.requestId)
      return
    case 'destroy':
      runtime.destroy()
      cancelledRequestIds.clear()
      workerScope.close()
      return
    default:
      postEvent({
        type: 'error',
        code: 'invalid-request',
        message: '收到未知图片编辑 Worker 请求',
        recoverable: true,
      })
  }
}

function enqueue(task: () => Promise<void>): void {
  renderQueue = renderQueue.then(task, task)
}

async function handlePreview(request: ImageEditWorkerPreviewRequest): Promise<void> {
  if (request.revision < latestPreviewRevision || isCancelled(request.requestId)) {
    postCancelled(request.requestId)
    return
  }
  const startedAt = performance.now()
  try {
    const result = await runtime.renderPreview(
      request.source,
      request.maxPixels,
      request.recipe,
      request.composition,
      request.source.kind === 'url' ? request.source.url : request.requestId,
      () => isCancelled(request.requestId)
    )
    if (request.revision < latestPreviewRevision || isCancelled(request.requestId)) {
      result.bitmap.close()
      postCancelled(request.requestId)
      return
    }
    postEvent({
      type: 'preview-completed',
      requestId: request.requestId,
      revision: request.revision,
      bitmap: result.bitmap,
      width: result.width,
      height: result.height,
      durationMs: performance.now() - startedAt,
    }, [result.bitmap])
  } catch (error) {
    postError(request.requestId, error)
  } finally {
    cancelledRequestIds.delete(request.requestId)
  }
}

async function handleExport(request: ImageEditWorkerExportRequest): Promise<void> {
  const startedAt = performance.now()
  try {
    const result = await runtime.exportImage(request.source, {
      format: request.format,
      quality: request.quality,
      tileSize: request.tileSize,
      halo: request.halo,
      globalScatterMaxDimension: request.globalScatterMaxDimension,
      recipe: request.recipe,
      composition: request.composition,
      isCancelled: () => isCancelled(request.requestId),
      onProgress: (completedTiles, totalTiles) => {
        postEvent({
          type: 'export-progress',
          requestId: request.requestId,
          completedTiles,
          totalTiles,
        })
      },
    })
    const bytes = result.bytes
    postEvent({
      type: 'export-completed',
      requestId: request.requestId,
      revision: request.revision,
      bytes,
      format: request.format,
      width: result.width,
      height: result.height,
      durationMs: performance.now() - startedAt,
    }, [bytes.buffer])
  } catch (error) {
    postError(request.requestId, error)
  } finally {
    cancelledRequestIds.delete(request.requestId)
  }
}

function isCancelled(requestId: string): boolean {
  return cancelledRequestIds.has(requestId)
}

function postCancelled(requestId: string): void {
  postEvent({ type: 'cancelled', requestId })
}

function postError(requestId: string, error: unknown): void {
  const cancelled = error instanceof DOMException && error.name === 'AbortError'
  if (cancelled) {
    postCancelled(requestId)
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  postEvent({
    type: 'error',
    requestId,
    code: classifyError(message),
    message,
    recoverable: true,
  })
}

function classifyError(message: string): ImageEditWorkerErrorCode {
  if (message.includes('解码') || message.includes('图片请求')) return 'decode-failed'
  if (message.includes('纹理上限')) return 'image-too-large'
  if (message.includes('navigator.gpu') || message.includes('GPU adapter')) {
    return 'device-unavailable'
  }
  if (message.includes('device lost')) return 'device-lost'
  if (message.includes('Blob')) return 'encoding-failed'
  return 'unknown'
}

function postEvent(event: ImageEditWorkerEvent, transfer: Transferable[] = []): void {
  workerScope.postMessage(event, transfer)
}
