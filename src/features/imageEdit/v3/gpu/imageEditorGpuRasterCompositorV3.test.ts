import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { init } from 'vgpu/node'
import type { Gpu } from 'vgpu'

import {
  compileImageEditRenderPlanV3,
  createBuiltInImageEditRenderNodeRegistry,
  decodeInterleavedRgbaSourceTileV3,
  executeImageEditCpuRenderPlanV3,
  resampleImageEditRgbaAffineV3,
} from '@/core/imageEdit/v3'
import type { ImageEditRenderPlanNode } from '@/core/imageEdit/v3/renderPlan'
import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import {
  compareImageEditorGoldenV3,
  createImageEditorGpuBaselineFixturesV3,
  type ImageEditorGpuBaselineFixtureV3,
} from '../testing/imageEditorGpuBaselineV3'
import { ImageEditorGpuRasterCompositorV3 } from './imageEditorGpuRasterCompositorV3'
import { compileImageEditorGpuRasterSceneV3 } from './imageEditorGpuRasterSceneCompilerV3'
import type { ImageEditorGpuSceneTileKeyV3 } from './imageEditorGpuSceneProtocolV3'

const registry = createBuiltInImageEditRenderNodeRegistry()
const FP16_COMPOSITION_TOLERANCE = 0.0011
let gpu: Gpu

beforeAll(async () => {
  gpu = await init()
})

afterAll(() => gpu.dispose())

describe('ImageEditorGpuRasterCompositorV3（真实 WebGPU）', () => {
  it.each(['kie-five-layer', 'sixteen-layer'] as const)(
    '%s 与同输入CPU golden保持FP16允许误差，且重复帧不上传或重建Pipeline',
    async (fixtureId) => {
      const fixture = createImageEditorGpuBaselineFixturesV3().find((entry) => entry.id === fixtureId)!
      const tiles = createSourceTiles(fixture)
      const descriptors = [...tiles.values()].map((tile) => ({
        resourceRef: tile.resourceRef,
        byteLength: tile.pixels.byteLength,
        mediaType: 'image/png',
      }))
      const compilation = compileImageEditorGpuRasterSceneV3(fixture.document, descriptors)
      expect(compilation.supported).toBe(true)
      if (!compilation.supported) return
      const compositor = new ImageEditorGpuRasterCompositorV3(gpu)
      compositor.syncScene(compilation.scene)
      compositor.updateViewport({
        stageWidth: fixture.renderSize.width,
        stageHeight: fixture.renderSize.height,
        viewportKey: 'gpu-golden',
        viewport: {
          documentX: 0,
          documentY: 0,
          width: fixture.renderSize.width,
          height: fixture.renderSize.height,
          zoom: 1,
          devicePixelRatio: 1,
        },
      })
      const resources = new Map<string, ReturnType<typeof compositor.uploadTile>>()
      for (const key of compilation.scene.requiredResourceKeys) {
        resources.set(key.resourceRef, compositor.uploadTile(key, tiles.get(key.resourceRef)!))
      }
      const resolve = (key: ImageEditorGpuSceneTileKeyV3) => resources.get(key.resourceRef) ?? null
      const reference = await renderCpuReference(fixture, tiles)
      const startedAt = performance.now()
      const first = await compositor.readLinearPixelsForTest(resolve)
      const firstFrameMs = performance.now() - startedAt
      const firstStats = compositor.snapshotStats()
      compositor.syncScene(compilation.scene)
      const second = await compositor.readLinearPixelsForTest(resolve)
      const secondStats = compositor.snapshotStats()
      const comparison = compareImageEditorGoldenV3(
        reference,
        first,
        FP16_COMPOSITION_TOLERANCE,
      )

      if (process.env.REPORT_GPU_GOLDEN === '1') {
        process.stdout.write(`[image-editor-gpu-golden] ${JSON.stringify({
          fixtureId,
          maxAbsoluteError: comparison.maxAbsoluteError,
          quantizedMaxLsbError: comparison.quantizedMaxLsbError,
          firstFrameMs,
          stats: secondStats,
        })}\n`)
      }

      expect(comparison.linearWithinTolerance).toBe(true)
      expect(comparison.quantizedMaxLsbError).toBeLessThanOrEqual(1)
      expect(firstStats.uploadCount).toBe(tiles.size)
      expect(firstStats.pipelineCompileCount).toBe(1)
      expect(secondStats.uploadCount).toBe(firstStats.uploadCount)
      expect(secondStats.pipelineCompileCount).toBe(firstStats.pipelineCompileCount)
      expect(second).toEqual(first)
      for (const resource of resources.values()) resource.destroy()
      compositor.dispose()
    },
  )

  it('LRU淘汰后同key重传会重绑新纹理而不重建Pipeline', async () => {
    const fixture = createImageEditorGpuBaselineFixturesV3()[0]
    fixture.document.layers = fixture.document.layers.slice(0, 1)
    const tiles = createSourceTiles(fixture)
    const originalTile = tiles.values().next().value
    if (!originalTile) throw new Error('LRU重传测试缺少源瓦片')
    const compilation = compileImageEditorGpuRasterSceneV3(fixture.document, [{
      resourceRef: originalTile.resourceRef,
      byteLength: originalTile.pixels.byteLength,
      mediaType: 'image/png',
    }])
    expect(compilation.supported).toBe(true)
    if (!compilation.supported) return
    const compositor = new ImageEditorGpuRasterCompositorV3(gpu)
    compositor.syncScene(compilation.scene)
    compositor.updateViewport({
      stageWidth: fixture.renderSize.width,
      stageHeight: fixture.renderSize.height,
      viewportKey: 'gpu-lru-reupload',
      viewport: {
        documentX: 0, documentY: 0,
        width: fixture.renderSize.width, height: fixture.renderSize.height,
        zoom: 1, devicePixelRatio: 1,
      },
    })
    const key = compilation.scene.requiredResourceKeys[0]
    const firstResource = compositor.uploadTile(key, originalTile)
    const first = await compositor.readLinearPixelsForTest(() => firstResource)
    firstResource.destroy()
    const replacementPixels = new Uint8Array(originalTile.pixels.byteLength)
    for (let offset = 0; offset < replacementPixels.length; offset += 4) {
      replacementPixels[offset] = 28
      replacementPixels[offset + 1] = 212
      replacementPixels[offset + 2] = 96
      replacementPixels[offset + 3] = 255
    }
    const replacement = compositor.uploadTile(key, {
      ...originalTile,
      pixels: replacementPixels.buffer,
    })
    const second = await compositor.readLinearPixelsForTest(() => replacement)

    expect(second).not.toEqual(first)
    expect(compositor.snapshotStats()).toMatchObject({
      uploadCount: 2,
      pipelineCompileCount: 1,
      frameCount: 2,
    })
    replacement.destroy()
    compositor.dispose()
  })
})

function createSourceTiles(fixture: ImageEditorGpuBaselineFixtureV3): Map<string, ImageEditorV3SourceTile> {
  const { width, height } = fixture.renderSize
  return new Map([...fixture.resourceSeeds].map(([resourceRef, seed]) => {
    const pixels = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4
        pixels[offset] = (x * 17 + seed * 29) % 256
        pixels[offset + 1] = (y * 23 + seed * 11) % 256
        pixels[offset + 2] = (x * 7 + y * 13 + seed * 19) % 256
        pixels[offset + 3] = 96 + ((x * 5 + y * 3 + seed) % 160)
      }
    }
    return [resourceRef, {
      resourceRef: resourceRef as `sha256:${string}`,
      mip: 0, tileX: 0, tileY: 0, halo: 0,
      width, height, channels: 4, bitDepth: 8, sampleFormat: 'uint', numericRange: 'unorm8',
      byteOrder: 'little-endian', rowStride: width * 4,
      colorSpace: 'srgb', transferFunction: 'srgb', alphaMode: 'straight',
      orientationApplied: true, originX: 0, originY: 0, pixels: pixels.buffer,
    } satisfies ImageEditorV3SourceTile]
  }))
}

async function renderCpuReference(
  fixture: ImageEditorGpuBaselineFixtureV3,
  tiles: ReadonlyMap<string, ImageEditorV3SourceTile>,
): Promise<Float32Array> {
  const { width, height } = fixture.renderSize
  const rect = { x: 0, y: 0, width, height }
  const output = await executeImageEditCpuRenderPlanV3(
    compileImageEditRenderPlanV3(fixture.document, registry, 'stable'),
    {
      loadRaster: async (node) => {
        const tile = tiles.get(resourceId(node))!
        return decodeInterleavedRgbaSourceTileV3({ ...tile, colorSpace: 'srgb' })
      },
      rasterizeAnnotations: async () => { throw new Error('基础场景不含标注') },
      transformContent: async (tile, transform) => resampleImageEditRgbaAffineV3(tile, rect, rect, transform),
    },
  )
  if (!output) throw new Error('CPU golden缺少输出')
  return output.data
}

function resourceId(node: ImageEditRenderPlanNode): string {
  const source = node.parameters.source as { resourceId?: unknown }
  if (typeof source?.resourceId !== 'string') throw new Error('栅格节点缺少资源')
  return source.resourceId
}
