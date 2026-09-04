import { describe, expect, it, vi } from 'vitest'

import type {
  ImageEditWebGpuDeviceLoss,
  ManagedWebGpuDevice,
} from '@/core/imageEdit/webgpu/deviceManager'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import {
  IMAGE_EDITOR_GPU_SCENE_DEFAULT_BUDGET_BYTES_V3,
  IMAGE_EDITOR_GPU_SCENE_PROTOCOL_VERSION_V3,
  type ImageEditorGpuSceneWorkerEventV3,
} from './imageEditorGpuSceneProtocolV3'
import { ImageEditorGpuSceneRuntimeV3 } from './imageEditorGpuSceneRuntimeV3'

function initializeRequest() {
  return {
    type: 'initialize' as const,
    protocolVersion: IMAGE_EDITOR_GPU_SCENE_PROTOCOL_VERSION_V3,
    sessionId: 'gpu-runtime-test',
    memoryBudgetBytes: IMAGE_EDITOR_GPU_SCENE_DEFAULT_BUDGET_BYTES_V3,
  }
}

function managedDevice(device: GpuDevice, generation: number): ManagedWebGpuDevice {
  return { provider: {}, adapter: {}, device, generation } as ManagedWebGpuDevice
}

describe('ImageEditorGpuSceneRuntimeV3', () => {
  it('同一会话只创建一个设备和一个 vGPU Context，并在 dispose 完整释放', async () => {
    const events: ImageEditorGpuSceneWorkerEventV3[] = []
    const contextDispose = vi.fn()
    const deviceDestroy = vi.fn()
    const device = { destroy: deviceDestroy } as unknown as GpuDevice
    const acquire = vi.fn(async () => managedDevice(device, 1))
    const destroy = vi.fn(() => deviceDestroy())
    const manager = {
      onDeviceLost: vi.fn(), acquire,
      getRecoveryStatus: () => ({ generation: 1, retryAfterMs: 0 }),
      destroy,
    }
    const contextFactory = vi.fn(async () => ({
      onError: () => vi.fn(),
      dispose: contextDispose,
    }))
    const runtime = new ImageEditorGpuSceneRuntimeV3((event) => events.push(event), {
      deviceManager: manager,
      contextFactory,
    })

    runtime.handle(initializeRequest())
    runtime.handle(initializeRequest())
    await vi.waitFor(() => expect(events.filter((event) => event.type === 'ready')).toHaveLength(2))

    expect(acquire).toHaveBeenCalledOnce()
    expect(contextFactory).toHaveBeenCalledOnce()
    runtime.dispose()
    expect(contextDispose).toHaveBeenCalledOnce()
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('设备丢失后释放旧 Context、请求缺失资源并按最新 scene 恢复', async () => {
    const events: ImageEditorGpuSceneWorkerEventV3[] = []
    const lostHandler: {
      value?: (reason: string, loss: ImageEditWebGpuDeviceLoss) => void
    } = {}
    let generation = 0
    const contexts: Array<{ dispose: ReturnType<typeof vi.fn> }> = []
    const manager = {
      onDeviceLost: (handler: (reason: string, loss: ImageEditWebGpuDeviceLoss) => void) => {
        lostHandler.value = handler
      },
      acquire: vi.fn(async () => managedDevice({} as GpuDevice, ++generation)),
      getRecoveryStatus: () => ({ generation, retryAfterMs: 0 }),
      destroy: vi.fn(),
    }
    const runtime = new ImageEditorGpuSceneRuntimeV3((event) => events.push(event), {
      deviceManager: manager,
      contextFactory: async () => {
        const state = { dispose: vi.fn() }
        contexts.push(state)
        return { onError: () => vi.fn(), dispose: state.dispose }
      },
    })
    runtime.handle(initializeRequest())
    runtime.handle({
      type: 'sync-scene',
      sceneGeneration: 4,
      document: createImageEditDocumentV3({ width: 32, height: 32 }),
      resourceDescriptors: [],
    })
    await vi.waitFor(() => expect(runtime.getStatus()).toBe('ready'))
    if (!lostHandler.value) throw new Error('未注册设备丢失处理器')
    lostHandler.value('reset', {
      generation: 1,
      reason: 'reset',
      recovery: { state: 'idle', generation: 1, recentLosses: 1, retryAfterMs: 0 },
    })

    await vi.waitFor(() => expect(runtime.getStatus()).toBe('ready'))
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'device-lost', sceneGeneration: 4 }),
      expect.objectContaining({ type: 'ready', sceneGeneration: 4, recovered: true }),
    ]))
    expect(contexts[0]?.dispose).toHaveBeenCalledOnce()
    expect(manager.acquire).toHaveBeenCalledTimes(2)
    runtime.dispose()
  })

  it('render 同时校验三类序列，旧请求静默丢弃', async () => {
    const events: ImageEditorGpuSceneWorkerEventV3[] = []
    const runtime = new ImageEditorGpuSceneRuntimeV3((event) => events.push(event), {
      deviceManager: {
        onDeviceLost: vi.fn(),
        acquire: async () => managedDevice({} as GpuDevice, 1),
        getRecoveryStatus: () => ({ generation: 1, retryAfterMs: 0 }),
        destroy: vi.fn(),
      },
      contextFactory: async () => ({ onError: () => vi.fn(), dispose: vi.fn() }),
    })
    runtime.handle(initializeRequest())
    runtime.handle({
      type: 'sync-scene', sceneGeneration: 2,
      document: createImageEditDocumentV3({ width: 16, height: 16 }), resourceDescriptors: [],
    })
    runtime.handle({
      type: 'update-viewport', sceneGeneration: 2, cameraSequence: 3,
      layout: {
        stageWidth: 16, stageHeight: 16, viewportKey: 'viewport',
        viewport: { documentX: 0, documentY: 0, width: 16, height: 16, zoom: 1, devicePixelRatio: 1 },
      },
    })
    runtime.handle({
      type: 'update-transform', sceneGeneration: 2, interactionSequence: 5,
      layerId: 'layer', transform: [1, 0, 0, 1, 4, 6],
    })
    await vi.waitFor(() => expect(runtime.getStatus()).toBe('ready'))
    const eventCount = events.length
    runtime.handle({
      type: 'render', requestId: 'stale', sceneGeneration: 2,
      cameraSequence: 2, interactionSequence: 5, quality: 'draft',
    })
    expect(events).toHaveLength(eventCount)
    runtime.handle({
      type: 'render', requestId: 'current', sceneGeneration: 2,
      cameraSequence: 3, interactionSequence: 5, quality: 'draft',
    })
    expect(events.at(-1)).toMatchObject({
      type: 'failed', requestId: 'current', code: 'composition-not-ready',
    })
    runtime.dispose()
  })
})
