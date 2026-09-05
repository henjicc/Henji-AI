import { describe, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditorV3PyramidDescriptor } from '@/platform/contracts/imageEditorV3'
import { ImageEditorGpuSceneClientV3 } from './imageEditorGpuSceneClientV3'
import type { ImageEditorGpuSceneWorkerEventV3, ImageEditorGpuSceneWorkerPortV3,
  ImageEditorGpuSceneWorkerRequestV3 } from './imageEditorGpuSceneProtocolV3'

const REF = `sha256:${'a'.repeat(64)}` as const
const pyramid: ImageEditorV3PyramidDescriptor = {
  tileSize: 512, levels: [{ mip: 0, width: 77, height: 55, columns: 1, rows: 1 }],
}
const layout = { stageWidth: 32, stageHeight: 32, viewportKey: 'test',
  viewport: { documentX: 0, documentY: 0, width: 32, height: 32, zoom: 1, devicePixelRatio: 1 } }
function snapshot(generation: number, withSource = true) {
  return {
    document: createImageEditDocumentV3({ width: 2048, height: 1024,
      ...(withSource ? { sourceResourceId: REF } : {}) }),
    renderGeneration: generation, geometryHash: 'geometry', quality: 'stable' as const,
    resourceDescriptors: [{ resourceRef: REF, mediaType: 'image/png', byteLength: 1 }],
  }
}
function deferred() {
  let resolve!: (value: ImageEditorV3PyramidDescriptor) => void
  let reject!: (error: Error) => void
  const promise = new Promise<ImageEditorV3PyramidDescriptor>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
function harness(reader: () => Promise<ImageEditorV3PyramidDescriptor>) {
  const messages: ImageEditorGpuSceneWorkerRequestV3[] = []
  const port: ImageEditorGpuSceneWorkerPortV3 = {
    onmessage: null, onerror: null, postMessage: (message) => { messages.push(message) }, terminate: vi.fn(),
  }
  const client = new ImageEditorGpuSceneClientV3({
    sessionId: 'geometry', workerFactory: () => port, sourcePyramidReader: reader,
  })
  const listener = vi.fn()
  client.subscribe(listener)
  const ready = () => port.onmessage?.({ data: {
    type: 'ready', sceneGeneration: 0, deviceGeneration: 1, recovered: false,
  } } as MessageEvent<ImageEditorGpuSceneWorkerEventV3>)
  const failed = () => port.onmessage?.({ data: {
    type: 'failed', sceneGeneration: 0, deviceGeneration: 0, requestId: null,
    code: 'initialization-failed', message: '初始化失败', recoverable: true, diagnostic: true,
  } } as MessageEvent<ImageEditorGpuSceneWorkerEventV3>)
  return { client, messages, listener, ready, failed }
}

describe('GPU 源几何同步顺序', () => {
  it('等待真实源几何再同步场景，合并交互，保留初始化早于几何完成的 ready', async () => {
    const pending = deferred()
    const h = harness(() => pending.promise)
    h.client.syncScene(snapshot(1))
    h.ready()
    for (let sequence = 1; sequence <= 100; sequence += 1) {
      h.client.updateViewport(1, sequence, layout)
      h.client.updateTransientLayerTransform(1, 'source', [1, 0, 0, 1, sequence, 0], sequence)
      h.client.requestFrame(1, sequence, sequence, 'draft')
    }
    expect(h.messages.map((message) => message.type)).toEqual(['initialize'])
    expect(h.listener).not.toHaveBeenCalled()
    pending.resolve(pyramid)
    await vi.waitFor(() => expect(h.messages).toHaveLength(5))
    expect(h.messages[1]).toMatchObject({ type: 'sync-scene', sourcePyramids: { [REF]: pyramid } })
    expect(h.messages.slice(2).map((message) => message.type)).toEqual(['update-viewport', 'update-transform', 'render'])
    expect(h.messages[4]).toMatchObject({ cameraSequence: 100, interactionSequence: 100 })
    expect(h.listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'ready', sceneGeneration: 1 }))
    h.client.dispose()
  })

  it('新场景替换未完成同步时丢弃旧请求和旧几何', async () => {
    const first = deferred()
    const second = deferred()
    const reader = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
    const h = harness(reader)
    h.client.syncScene(snapshot(1))
    h.client.updateViewport(1, 10, layout)
    h.client.syncScene(snapshot(2))
    h.client.updateViewport(2, 1, layout)
    second.resolve(pyramid)
    await vi.waitFor(() => expect(h.messages).toHaveLength(3))
    first.resolve({ ...pyramid, levels: [{ ...pyramid.levels[0], width: 1 }] })
    await Promise.resolve()
    expect(h.messages[1]).toMatchObject({ type: 'sync-scene', sceneGeneration: 2, sourcePyramids: { [REF]: pyramid } })
    expect(h.messages[2]).toMatchObject({ type: 'update-viewport', sceneGeneration: 2, cameraSequence: 1 })
    expect(h.messages).toHaveLength(3)
    h.client.dispose()
  })

  it('切换为空场景仍发布待交接 ready', async () => {
    const pending = deferred()
    const h = harness(() => pending.promise)
    h.client.syncScene(snapshot(1))
    h.ready()
    h.client.syncScene(snapshot(2, false))
    expect(h.listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'ready', sceneGeneration: 2 }))
    pending.resolve(pyramid)
    await Promise.resolve()
    expect(h.messages.filter((message) => message.type === 'sync-scene')).toHaveLength(1)
    h.client.dispose()
  })

  it('几何先完成、初始化 ready 随后到达时仍接收设备就绪', async () => {
    const h = harness(async () => pyramid)
    h.client.syncScene(snapshot(2))
    await vi.waitFor(() => expect(h.messages.some((message) => message.type === 'sync-scene')).toBe(true))
    h.ready()
    expect(h.listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'ready', sceneGeneration: 2 }))
    h.client.dispose()
  })

  it('元数据失败公开回退事件并清除排队帧', async () => {
    const pending = deferred()
    const h = harness(() => pending.promise)
    h.client.syncScene(snapshot(1))
    h.ready()
    h.client.updateViewport(1, 1, layout)
    pending.reject(new Error('资源缺失'))
    await vi.waitFor(() => expect(h.listener).toHaveBeenCalledWith(expect.objectContaining({
      type: 'failed', code: 'initialization-failed', sceneGeneration: 1,
    })))
    expect(h.messages.map((message) => message.type)).toEqual(['initialize'])
    h.client.dispose()
  })

  it.each([false, true])('初始化失败不依赖几何同步是否已完成（%s）', async (completed) => {
    const pending = deferred()
    const h = harness(() => pending.promise)
    h.client.syncScene(snapshot(3))
    if (completed) {
      pending.resolve(pyramid)
      await vi.waitFor(() => expect(h.messages.some((message) => message.type === 'sync-scene')).toBe(true))
    }
    h.failed()
    expect(h.listener).toHaveBeenCalledWith(expect.objectContaining({
      type: 'failed', code: 'initialization-failed', sceneGeneration: 3,
    }))
    h.client.dispose()
  })
})
