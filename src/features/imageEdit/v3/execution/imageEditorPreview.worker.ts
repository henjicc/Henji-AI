/// <reference lib="webworker" />

import { ImageEditRenderNodeUnsupportedErrorV3 } from '@/core/imageEdit/v3/execution'
import {
  ImageEditorPreviewUnsupportedEffectErrorV3,
  ImageEditorPreviewCustomEffectsV3,
} from './previewCustomEffectsV3'
import {
  ImageEditorPreviewUnsupportedContentErrorV3,
  linearPreviewTileToImageDataV3,
} from './previewPixelsV3'
import type {
  ImageEditorPreviewWorkerEventV3,
  ImageEditorPreviewWorkerRequestV3,
} from './previewProtocolV3'
import { renderImageEditorPreviewTileV3 } from './previewWorkerRendererV3'

const workerScope = self as DedicatedWorkerGlobalScope
const customEffects = new ImageEditorPreviewCustomEffectsV3()
const activeControllers = new Map<string, AbortController>()

workerScope.onmessage = (event: MessageEvent<ImageEditorPreviewWorkerRequestV3>): void => {
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
  request: Extract<ImageEditorPreviewWorkerRequestV3, { type: 'render' }>,
  signal: AbortSignal,
): Promise<void> {
  try {
    const result = await renderImageEditorPreviewTileV3(request, customEffects, signal)
    if (signal.aborted) throw abortError()
    const imageData = linearPreviewTileToImageDataV3(result.tile)
    const canvas = new OffscreenCanvas(result.tile.width, result.tile.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Worker 无法创建预览输出画布')
    context.putImageData(imageData, 0, 0)
    if (typeof canvas.transferToImageBitmap === 'function') {
      const bitmap = canvas.transferToImageBitmap()
      postEvent({
        type: 'rendered-bitmap',
        requestId: request.requestId,
        sequence: request.sequence,
        width: result.tile.width,
        height: result.tile.height,
        diagnostics: result.diagnostics,
        execution: result.execution,
        bitmap,
      }, [bitmap])
      return
    }
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    const bytes = await blob.arrayBuffer()
    postEvent({
      type: 'rendered-blob',
      requestId: request.requestId,
      sequence: request.sequence,
      width: result.tile.width,
      height: result.tile.height,
      diagnostics: result.diagnostics,
      execution: result.execution,
      mediaType: 'image/png',
      bytes,
    }, [bytes])
  } catch (error) {
    postFailure(request.requestId, request.sequence, error, signal.aborted)
  }
}

function postFailure(
  requestId: string,
  sequence: number,
  error: unknown,
  aborted: boolean,
): void {
  const unsupported = error instanceof ImageEditorPreviewUnsupportedEffectErrorV3
    || error instanceof ImageEditorPreviewUnsupportedContentErrorV3
    || error instanceof ImageEditRenderNodeUnsupportedErrorV3
  postEvent({
    type: 'failed',
    requestId,
    sequence,
    code: aborted ? 'aborted' : unsupported ? 'unsupported-effect' : 'render-failed',
    message: error instanceof Error ? error.message : String(error),
  })
}

function abortError(): Error {
  const error = new Error('图片预览已经取消')
  error.name = 'AbortError'
  return error
}

function postEvent(event: ImageEditorPreviewWorkerEventV3, transfer: Transferable[] = []): void {
  workerScope.postMessage(event, transfer)
}
