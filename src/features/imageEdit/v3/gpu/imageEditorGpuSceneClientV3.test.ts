import { describe, expect, it, vi } from 'vitest'

import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import { ImageEditorGpuSceneClientV3 } from './imageEditorGpuSceneClientV3'
import type {
  ImageEditorGpuSceneWorkerEventV3,
  ImageEditorGpuSceneWorkerPortV3,
  ImageEditorGpuSceneWorkerRequestV3,
} from './imageEditorGpuSceneProtocolV3'

function createPort() {
  const messages: ImageEditorGpuSceneWorkerRequestV3[] = []
  const port: ImageEditorGpuSceneWorkerPortV3 = {
    onmessage: null,
    onerror: null,
    postMessage: vi.fn((message) => { messages.push(message) }),
    terminate: vi.fn(),
  }
  return {
    messages,
    port,
    emit: (event: ImageEditorGpuSceneWorkerEventV3) => {
      port.onmessage?.({ data: event } as MessageEvent<ImageEditorGpuSceneWorkerEventV3>)
    },
  }
}

describe('ImageEditorGpuSceneClientV3', () => {
  it('每客户端只创建一个 Worker，2.1 默认允许请求隐藏GPU帧', () => {
    const worker = createPort()
    const workerFactory = vi.fn(() => worker.port)
    const client = new ImageEditorGpuSceneClientV3({
      sessionId: 'gpu-client-test',
      workerFactory,
    })
    const snapshot = {
      document: createImageEditDocumentV3({ width: 32, height: 32 }),
      renderGeneration: 4,
      geometryHash: 'geometry',
      quality: 'stable' as const,
      resourceDescriptors: [],
    }
    client.syncScene(snapshot)
    client.updateViewport(4, 2, {
      stageWidth: 32,
      stageHeight: 32,
      viewportKey: 'viewport',
      viewport: { documentX: 0, documentY: 0, width: 32, height: 32, zoom: 1, devicePixelRatio: 1 },
    })
    client.updateTransientLayerTransform(4, 'source', [1, 0, 0, 1, 2, 3], 5)
    client.requestFrame(4, 2, 5, 'draft')

    expect(workerFactory).toHaveBeenCalledOnce()
    expect(worker.messages.map((message) => message.type)).toEqual([
      'initialize', 'sync-scene', 'update-viewport', 'update-transform',
      'render',
    ])
    client.dispose()
    expect(worker.port.terminate).toHaveBeenCalledOnce()
  })

  it('关闭过期 frame-ready 的位图，只发布三类序列都匹配的帧', () => {
    const worker = createPort()
    const client = new ImageEditorGpuSceneClientV3({
      sessionId: 'gpu-client-sequence-test',
      workerFactory: () => worker.port,
      renderingEnabled: true,
    })
    client.syncScene({
      document: createImageEditDocumentV3({ width: 32, height: 32 }),
      renderGeneration: 3,
      geometryHash: 'geometry',
      quality: 'draft',
      resourceDescriptors: [],
    })
    client.updateViewport(3, 4, {
      stageWidth: 32,
      stageHeight: 32,
      viewportKey: 'viewport',
      viewport: { documentX: 0, documentY: 0, width: 32, height: 32, zoom: 1, devicePixelRatio: 1 },
    })
    client.updateTransientLayerTransform(3, 'source', [1, 0, 0, 1, 0, 0], 6)
    const listener = vi.fn()
    client.subscribe(listener)
    const closeStale = vi.fn()
    worker.emit({
      type: 'frame-ready', requestId: 'stale', sceneGeneration: 3,
      cameraSequence: 3, interactionSequence: 6, deviceGeneration: 1,
      quality: 'draft', bitmap: { close: closeStale } as unknown as ImageBitmap,
    })
    const closeCurrent = vi.fn()
    worker.emit({
      type: 'frame-ready', requestId: 'current', sceneGeneration: 3,
      cameraSequence: 4, interactionSequence: 6, deviceGeneration: 1,
      quality: 'draft', bitmap: { close: closeCurrent } as unknown as ImageBitmap,
    })

    expect(closeStale).toHaveBeenCalledOnce()
    expect(closeCurrent).not.toHaveBeenCalled()
    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'current' }))
    client.dispose()
  })
})
