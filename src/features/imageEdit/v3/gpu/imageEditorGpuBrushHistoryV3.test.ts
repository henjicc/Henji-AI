import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { init, type Gpu } from 'vgpu/node'
import { createImageEditEffectLayerV3 } from '@/core/imageEdit/v3'
import { SOURCE, createRasterSourceBrushFixtureV3 } from '../editor/rasterBrushSourceGeometryV3.testSupport'
import { floatPremultipliedTileToGpuSource } from '../execution/imageEditorGpuTileSourceV3'
import { ImageEditorGpuRasterCompositorV3 } from './imageEditorGpuRasterCompositorV3'
import { compileImageEditorGpuRasterSceneV3 } from './imageEditorGpuRasterSceneCompilerV3'
import { imageEditorGpuSceneTileKeyV3 } from './imageEditorGpuSceneProtocolV3'

let gpu: Gpu
beforeAll(async () => { gpu = await init() })
afterAll(() => gpu?.dispose())

describe('真实GPU同会话画笔历史与flat/graph往返', () => {
  it.each([{ source: 16, scale: 1, from: 48, to: 52 }, { source: 640, scale: .1, from: 500, to: 540 }])(
    '$source源在DPR1.8撤销重做保持同一资源的精确像素', async ({ source, scale, from, to }) => {
      const value = createRasterSourceBrushFixtureV3(source, 64, scale)
      type BrushTile = NonNullable<ReturnType<typeof value.stored.get>>
      const brushes = new Map<`sha256:${string}`, BrushTile>()
      // 每个真实覆盖瓦片使用独立内容身份；redo沿用原有身份，不重新持久化。
      value.persistTiles.mockImplementation(async (tiles) => tiles.map(({ tileKey, tile }) => {
        const resourceId = `sha256:${(brushes.size + 1).toString(16).padStart(64, '0')}` as const
        value.stored.set(tileKey, tile)
        brushes.set(resourceId, tile)
        return { tileKey, resourceId, byteSize: tile.data.byteLength }
      }))
      const compositor = new ImageEditorGpuRasterCompositorV3(gpu)
      const textures = new Map<string, ReturnType<typeof compositor.uploadTile>>()
      const render = async (graph: boolean) => {
        const descriptors = [{ resourceRef: SOURCE, byteLength: source * source * 4, mediaType: 'image/png' },
          ...[...brushes].map(([resourceRef, tile]) => ({ resourceRef, byteLength: tile.data.byteLength,
            mediaType: 'application/x-henji-brush-tile-v3' }))]
        const compiled = compileImageEditorGpuRasterSceneV3(value.bus.getSnapshot().document,
          descriptors, { [SOURCE]: value.pyramid })
        if (!compiled.supported) throw new Error(compiled.reason)
        expect(compiled.scene.requiresRenderGraph).toBe(graph)
        compositor.syncScene(compiled.scene)
        compositor.updateViewport({ stageWidth: 64, stageHeight: 64, viewportKey: 'history-dpr1.8',
          viewport: { documentX: 0, documentY: 0, width: 64, height: 64, zoom: 1, devicePixelRatio: 1.8 } })
        for (const key of compositor.requiredResourceKeys()) {
          const id = imageEditorGpuSceneTileKeyV3(key)
          if (textures.has(id)) continue
          const brush = brushes.get(key.resourceRef)
          const tile = brush ? floatPremultipliedTileToGpuSource(key, brush.data, brush.width, brush.height)
            : await value.readSourceTile({ mip: key.mip, x: key.tileX, y: key.tileY })
          textures.set(id, compositor.uploadTile(key, tile))
        }
        return compositor.readPresentedPixelsForTest((key) => textures.get(imageEditorGpuSceneTileKeyV3(key)) ?? null)
      }
      try {
        const initial = await render(false)
        value.stroke.begin()
        for (let x = from; x <= to; x += (to - from) / 12) {
          const y = source === 640 ? 505 : from
          await value.stroke.append([{ x, y, screenX: x * scale, screenY: y * scale }])
        }
        await value.stroke.finish()
        if (source === 640) expect([...value.stored.keys()].sort()).toEqual(['0/0/0', '0/1/0'])
        const paintedDocument = value.bus.getSnapshot().document
        const painted = await render(false)
        expect(painted).not.toEqual(initial)
        const effect = createImageEditEffectLayerV3('blur', '模糊', 'image.fast-blur-v3', { radius: 12 })
        value.bus.dispatch({ type: 'layer.add', commandId: 'add-blur', expectedRevision: paintedDocument.revision,
          parentId: null, index: 1, layer: effect, resources: [] })
        const blurred = await render(true)
        expect(blurred).not.toEqual(painted)
        expect(value.bus.undo()).toBe(true)
        expect(await render(false)).toEqual(painted)
        expect(value.bus.undo()).toBe(true)
        expect(await render(false)).toEqual(initial)
        expect(value.bus.redo()).toBe(true)
        expect(value.bus.getSnapshot().document.layers).toEqual(paintedDocument.layers)
        expect(await render(false)).toEqual(painted)
        expect(value.bus.redo()).toBe(true)
        expect(await render(true)).toEqual(blurred)
        expect(value.persistTiles).toHaveBeenCalledTimes(1)
      } finally {
        for (const resource of textures.values()) resource.destroy()
        compositor.dispose()
      }
    },
  )
})
