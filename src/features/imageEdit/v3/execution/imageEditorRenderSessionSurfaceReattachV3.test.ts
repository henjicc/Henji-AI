/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'

import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditorGpuSceneClientV3Like } from '../gpu/imageEditorGpuSceneClientV3'
import type { ImageEditorGpuSceneWorkerEventV3 } from '../gpu/imageEditorGpuSceneProtocolV3'
import { DefaultImageEditorRenderSessionV3 } from './imageEditorRenderSessionV3'
import {
  installImageEditorRenderSessionTestSurface,
  layout,
  result,
} from './imageEditorRenderSessionTestFixtures'
import type {
  ImageEditorManagedViewportCompositeV3,
  ImageEditorViewportCompositeRequestV3,
} from './viewportCompositeTypesV3'

describe('RenderSession GPU Surface 重挂', () => {
  installImageEditorRenderSessionTestSurface()

  it('已接管时更换canvas不等后续事件，先重现稳定帧并主动请求新GPU帧', async () => {
    const pending: Array<{
      request: ImageEditorViewportCompositeRequestV3
      resolve(value: ImageEditorManagedViewportCompositeV3): void
    }> = []
    let emit: (event: ImageEditorGpuSceneWorkerEventV3) => void = () => undefined
    const requestFrame = vi.fn()
    const attachPresentationSurface = vi.fn()
    const gpuClient: ImageEditorGpuSceneClientV3Like = {
      attachPresentationSurface,
      syncScene: vi.fn(),
      uploadTiles: vi.fn(),
      updateTransientLayerTransform: vi.fn(),
      clearTransientLayerTransform: vi.fn(),
      updateViewport: vi.fn(),
      requestFrame,
      subscribe: (listener) => { emit = listener; return vi.fn() },
      dispose: vi.fn(),
    }
    const client = {
      render: (request: ImageEditorViewportCompositeRequestV3) => (
        new Promise<ImageEditorManagedViewportCompositeV3>((resolve) => {
          pending.push({ request, resolve })
        })
      ),
      cancel: vi.fn(),
      dispose: vi.fn(),
    }
    const session = new DefaultImageEditorRenderSessionV3(
      { sessionId: 'surface-reattach' },
      { client, gpuSceneClient: gpuClient },
    )
    const first = createSurface('first')
    session.attachSurface(first)
    session.updateViewport(layout)
    session.updateSnapshot({
      document: createImageEditDocumentV3({ width: 1_600, height: 1_000 }),
      renderGeneration: 1,
      geometryHash: 'same-geometry',
      quality: 'stable',
      resourceDescriptors: [],
    })
    const target = pending.find((entry) => entry.request.phase === 'target')
    if (!target) throw new Error('缺少重挂前稳定帧')
    target.resolve(result(target.request))
    await vi.advanceTimersByTimeAsync(0)
    expect(first.front.dataset.renderGeneration).toBe('1')

    emit({ type: 'ready', sceneGeneration: 1, deviceGeneration: 1, recovered: false })
    emit({ type: 'scene-resources-ready', sceneGeneration: 1, deviceGeneration: 1 })
    emit(surfaceFrame(1))
    expect(first.gpu.style.visibility).toBe('visible')
    session.requestFrame('stable')
    const cpuTasksBefore = pending.length
    const gpuFramesBefore = requestFrame.mock.calls.length

    const next = createSurface('next')
    session.attachSurface(next)

    expect(attachPresentationSurface).toHaveBeenLastCalledWith(2, expect.anything())
    expect(next.front.dataset.renderGeneration).toBe('1')
    expect([next.front.style.visibility, next.gpu.style.visibility]).toEqual(['visible', 'hidden'])
    expect(pending).toHaveLength(cpuTasksBefore)
    expect(requestFrame).toHaveBeenCalledTimes(gpuFramesBefore + 1)

    emit(surfaceFrame(2))
    expect([next.front.style.visibility, next.gpu.style.visibility]).toEqual(['hidden', 'visible'])
    const gpuFramesAfterHandoff = requestFrame.mock.calls.length
    session.attachSurface(next)
    expect(next.transfer).toHaveBeenCalledOnce()
    expect(requestFrame).toHaveBeenCalledTimes(gpuFramesAfterHandoff)
    expect(pending).toHaveLength(cpuTasksBefore)
    expect([next.front.style.visibility, next.gpu.style.visibility]).toEqual(['hidden', 'visible'])
    session.dispose()
  })
})

function createSurface(surfaceId: string) {
  const front = document.createElement('canvas')
  const safety = document.createElement('canvas')
  const gpu = document.createElement('canvas')
  const transfer = vi.fn(() => ({ width: 800, height: 500 } as OffscreenCanvas))
  Object.defineProperty(gpu, 'transferControlToOffscreen', {
    value: transfer,
  })
  return { surfaceId, front, safety, gpu, transfer }
}

function surfaceFrame(surfaceGeneration: number): ImageEditorGpuSceneWorkerEventV3 {
  return {
    type: 'surface-frame-ready',
    requestId: `surface-${surfaceGeneration}`,
    sceneGeneration: 1,
    deviceGeneration: 1,
    cameraSequence: 1,
    interactionSequence: 0,
    surfaceGeneration,
    quality: 'stable',
    width: 800,
    height: 500,
  }
}
