import { describe, expect, it, vi } from 'vitest'

import type { ImageEditorGpuSceneClientV3Like } from '../gpu/imageEditorGpuSceneClientV3'
import { ImageEditorRenderSessionGpuBridgeV3 } from './imageEditorRenderSessionGpuBridgeV3'

describe('ImageEditorRenderSessionGpuBridgeV3', () => {
  it('销毁会话时只退订并销毁唯一GPU Scene客户端', () => {
    const unsubscribe = vi.fn()
    const client = {
      syncScene: vi.fn(), uploadTiles: vi.fn(), updateTransientLayerTransform: vi.fn(),
      clearTransientLayerTransform: vi.fn(), updateViewport: vi.fn(), requestFrame: vi.fn(),
      subscribe: vi.fn(() => unsubscribe), dispose: vi.fn(),
    } satisfies ImageEditorGpuSceneClientV3Like
    const bridge = new ImageEditorRenderSessionGpuBridgeV3(
      'gpu-bridge-test',
      client,
      vi.fn(),
    )

    bridge.dispose()
    bridge.dispose()

    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(client.dispose).toHaveBeenCalledOnce()
  })
})
