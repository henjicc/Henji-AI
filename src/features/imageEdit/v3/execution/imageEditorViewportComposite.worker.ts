/// <reference lib="webworker" />

import { linearPreviewTileToImageDataV3 } from './previewPixelsV3'
import { imageEditOutputSizeV3 } from '@/core/imageEdit/v3'
import { ImageEditorPreviewCustomEffectsV3 } from './previewCustomEffectsV3'
import type {
  ImageEditorViewportCompositeBitmapTileV3,
  ImageEditorViewportCompositeWorkerEventV3,
  ImageEditorViewportCompositeWorkerRequestV3,
} from './viewportCompositeProtocolV3'
import { renderImageEditorViewportCompositeV3 } from './viewportCompositeRendererV3'

const workerScope = self as DedicatedWorkerGlobalScope
const activeControllers = new Map<string, AbortController>()
const customEffects = new ImageEditorPreviewCustomEffectsV3()

workerScope.onmessage = (event: MessageEvent<ImageEditorViewportCompositeWorkerRequestV3>): void => {
  const request = event.data
  if (request.type === 'cancel') {
    activeControllers.get(request.requestId)?.abort()
    return
  }
  if (request.type === 'dispose') {
    for (const controller of activeControllers.values()) controller.abort()
    activeControllers.clear()
    customEffects.dispose()
    workerScope.close()
    return
  }
  const controller = new AbortController()
  activeControllers.set(request.requestId, controller)
  void renderRequest(request, controller.signal).finally(() => {
    activeControllers.delete(request.requestId)
  })
}

async function renderRequest(
  request: Extract<ImageEditorViewportCompositeWorkerRequestV3, { type: 'render' }>,
  signal: AbortSignal,
): Promise<void> {
  let completedTiles = 0
  try {
    const diagnostics = await renderImageEditorViewportCompositeV3(
      request,
      signal,
      async ({ tile, outputRect }) => {
        if (signal.aborted) throw abortError()
        const canvas = new OffscreenCanvas(tile.width, tile.height)
        const context = canvas.getContext('2d')
        if (!context || typeof canvas.transferToImageBitmap !== 'function') {
          throw new Error('当前 Worker 无法发布视口 ImageBitmap 瓦片')
        }
        context.putImageData(linearPreviewTileToImageDataV3(tile), 0, 0)
        const bitmap = canvas.transferToImageBitmap()
        if (signal.aborted) {
          bitmap.close()
          throw abortError()
        }
        const bitmapTile: ImageEditorViewportCompositeBitmapTileV3 = { bitmap, outputRect }
        postEvent({
          type: 'tile-rendered',
          requestId: request.requestId,
          sequence: request.sequence,
          renderGeneration: request.renderGeneration,
          cameraSequence: request.cameraSequence,
          geometryHash: request.geometryHash,
          revision: request.document.revision,
          mip: request.plan.mip,
          tileIndex: completedTiles,
          tile: bitmapTile,
        }, [bitmap])
        completedTiles += 1
      },
      { customEffects },
    )
    if (signal.aborted) throw abortError()
    postEvent({
      type: 'rendered',
      requestId: request.requestId,
      sequence: request.sequence,
      renderGeneration: request.renderGeneration,
      cameraSequence: request.cameraSequence,
      geometryHash: request.geometryHash,
      revision: request.document.revision,
      mip: request.plan.mip,
      documentWidth: imageEditOutputSizeV3(request.document.geometry).width,
      documentHeight: imageEditOutputSizeV3(request.document.geometry).height,
      diagnostics,
      completedTiles,
    })
  } catch (error) {
    postEvent({
      type: 'failed',
      requestId: request.requestId,
      sequence: request.sequence,
      renderGeneration: request.renderGeneration,
      code: signal.aborted ? 'aborted' : 'render-failed',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

function abortError(): Error {
  const error = new Error('视口分块渲染已取消')
  error.name = 'AbortError'
  return error
}

function postEvent(
  event: ImageEditorViewportCompositeWorkerEventV3,
  transfer: Transferable[] = [],
): void {
  workerScope.postMessage(event, transfer)
}
