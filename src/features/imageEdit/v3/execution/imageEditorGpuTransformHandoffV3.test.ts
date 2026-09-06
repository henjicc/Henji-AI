import { describe, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditTransformV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditorGpuSceneClientV3Like } from '../gpu/imageEditorGpuSceneClientV3'
import type { ImageEditorGpuSceneWorkerEventV3 } from '../gpu/imageEditorGpuSceneProtocolV3'
import { ImageEditorRenderSessionGpuBridgeV3 } from './imageEditorRenderSessionGpuBridgeV3'

describe('GPU 瞬态到权威场景的交接', () => {
  it('提交前保留最后矩阵，新资源延迟时不画旧位置，旧帧不能覆盖新场景', () => {
    let listener: (event: ImageEditorGpuSceneWorkerEventV3) => void = () => undefined
    let base: ImageEditTransformV3 = [1, 0, 0, 1, 0, 0]
    let transient: ImageEditTransformV3 | null = null
    const requested: ImageEditTransformV3[] = []
    const client = {
      syncScene: vi.fn((snapshot) => {
        base = [...snapshot.document.layers[0].transform]
        transient = null // 正式 Worker 的 sync-scene 同步替换场景并清理瞬态。
      }),
      updateTransientLayerTransform: vi.fn((_generation, _layer, transform) => { transient = transform }),
      clearTransientLayerTransform: vi.fn(() => { transient = null }),
      requestFrame: vi.fn(() => { requested.push([...(transient ?? base)]) }),
      updateViewport: vi.fn(), uploadTiles: vi.fn(), dispose: vi.fn(),
      subscribe: (next) => { listener = next; return vi.fn() },
    } satisfies ImageEditorGpuSceneClientV3Like
    const present = vi.fn(() => true)
    const bridge = new ImageEditorRenderSessionGpuBridgeV3('handoff', client, vi.fn(), false, present)
    const document = createImageEditDocumentV3({ width: 320, height: 180, sourceResourceId: 'sha256:source' })
    const snapshot = { document, renderGeneration: 1, quality: 'stable' as const,
      geometryHash: 'handoff', resourceDescriptors: [] }
    bridge.updateViewport(1, { stageWidth: 320, stageHeight: 180, viewportKey: 'handoff',
      viewport: { documentX: 0, documentY: 0, width: 320, height: 180, zoom: 1, devicePixelRatio: 1 } })
    bridge.syncSnapshot(snapshot)
    listener({ type: 'ready', sceneGeneration: 1, deviceGeneration: 1, recovered: false })
    const resourcesReady = (sceneGeneration: number): void => listener({
      type: 'scene-resources-ready', sceneGeneration, deviceGeneration: 1,
    })
    const complete = (sceneGeneration: number, interactionSequence: number): ReturnType<typeof vi.fn> => {
      const close = vi.fn()
      listener({ type: 'frame-ready', sceneGeneration, interactionSequence, cameraSequence: 1,
        deviceGeneration: 1, surfaceGeneration: 0, requestId: 'handoff-frame', quality: 'draft',
        bitmap: { width: 320, height: 180, close } as unknown as ImageBitmap,
        diagnostics: { uploadCount: 0, pipelineCompileCount: 1, frameCount: 1,
          diagnosticReadbackCount: 0, transientUniformUpdateCount: 1, residentTileCount: 0,
          atlasPageCount: 0, allocatedAtlasBytes: 0, minimumPlannedMip: 0, maximumPlannedMip: 0,
          surfaceFrameCount: 0, imageBitmapFrameCount: 1, directSurfaceFailureCount: 0 },
      })
      return close
    }
    try {
      resourcesReady(1)
      complete(1, 0)
      bridge.updateTransientLayerTransform(document.layers[0].id, [1, 0, 0, 1, 20, 10], 1)
      bridge.requestFrame('draft')
      const final: ImageEditTransformV3 = [1, 0, 0, 1, 80, 40]
      bridge.updateTransientLayerTransform(document.layers[0].id, final, 2)
      bridge.requestFrame('draft')
      // 松手时新快照尚未到达；前一帧完成后，最后一次 pointermove 仍必须呈现。
      complete(1, 1)
      expect(requested.at(-1)).toEqual(final)
      const committed = structuredClone(document)
      committed.revision = 1
      committed.layers[0].transform = final
      bridge.syncSnapshot({ ...snapshot, document: committed, renderGeneration: 2 })
      const count = requested.length
      const presentCount = present.mock.calls.length
      expect(complete(1, 2)).toHaveBeenCalledOnce()
      expect(present).toHaveBeenCalledTimes(presentCount)
      bridge.requestFrame('stable')
      expect(requested).toHaveLength(count) // 资源未就绪时保留现有表面，不提交旧场景。
      resourcesReady(2)
      expect(requested.at(-1)).toEqual(final)
      expect(client.clearTransientLayerTransform).not.toHaveBeenCalled()
      complete(2, 0)
      // 下一次移动后取消，恢复的是上一次提交位置，不是文档最初位置。
      bridge.updateTransientLayerTransform(document.layers[0].id, [1, 0, 0, 1, 90, 50], 3)
      bridge.requestFrame('draft')
      complete(2, 3)
      bridge.clearTransientLayerTransform(document.layers[0].id, 4)
      bridge.requestFrame('draft')
      expect(requested.at(-1)).toEqual(final)
      expect(requested.slice(2)).not.toContainEqual([1, 0, 0, 1, 0, 0])
    } finally { bridge.dispose() }
  })
})
