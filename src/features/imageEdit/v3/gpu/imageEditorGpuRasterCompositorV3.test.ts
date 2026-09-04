import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { init } from 'vgpu/node'
import type { Gpu } from 'vgpu'

import {
  compileImageEditRenderPlanV3,
  createBuiltInImageEditRenderNodeRegistry,
  createImageEditDocumentV3,
  createImageEditRasterLayerV3,
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
import { imageEditorGpuSceneTileKeyV3 } from './imageEditorGpuSceneProtocolV3'

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
      for (const key of compositor.requiredResourceKeys()) {
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
      expect(firstStats.pipelineCompileCount).toBeGreaterThanOrEqual(1)
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
    const key = compositor.requiredResourceKeys()[0]
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

  it('8192 场景只上传视口瓦片，halo 跨越 512 边界无接缝', async () => {
    const resourceRef = `sha256:${'d'.repeat(64)}` as const
    const document = createImageEditorGpuBaselineFixturesV3()
      .find((entry) => entry.id === 'large-8192')!.document
    document.layers = document.layers.slice(0, 1)
    const layer = document.layers[0]
    if (layer.type !== 'raster') throw new Error('large-8192 基线首层必须是栅格层')
    layer.source = { kind: 'resource', resourceId: resourceRef }
    layer.transform = [1, 0, 0, 1, 0, 0]
    layer.opacity = 1
    const compilation = compileImageEditorGpuRasterSceneV3(document, [{
      resourceRef, byteLength: 8_192 * 8_192 * 4, mediaType: 'image/png',
    }])
    expect(compilation.supported).toBe(true)
    if (!compilation.supported) return
    const compositor = new ImageEditorGpuRasterCompositorV3(gpu)
    compositor.syncScene(compilation.scene)
    compositor.updateViewport({
      stageWidth: 1_024, stageHeight: 8, viewportKey: 'large-seam',
      viewport: {
        documentX: 0.25, documentY: 0, width: 1_024, height: 8,
        zoom: 1, devicePixelRatio: 1,
      },
    })
    const resources = new Map<string, ReturnType<typeof compositor.uploadTile>>()
    for (const key of compositor.requiredResourceKeys()) {
      const source = largeStepTile(key)
      resources.set(imageEditorGpuSceneTileKeyV3(key), compositor.uploadTile(key, source))
      expect(source.width).toBeLessThanOrEqual(514)
    }
    const pixels = await compositor.readLinearPixelsForTest(
      (key) => resources.get(imageEditorGpuSceneTileKeyV3(key)) ?? null,
    )
    const redAt = (x: number) => pixels[x * 4]

    expect(compositor.requiredResourceKeys().length).toBeLessThan(8)
    expect(redAt(510)).toBeCloseTo(0, 4)
    expect(redAt(511)).toBeCloseTo(0.25, 3)
    expect(redAt(512)).toBeCloseTo(1, 4)
    expect(compositor.snapshotStats()).toMatchObject({
      uploadCount: resources.size,
      atlasPageCount: 1,
      residentTileCount: resources.size,
    })
    for (const resource of resources.values()) resource.destroy()
    compositor.dispose()
  })

  it('1024 大图 screen blend 由RenderGraph消费atlas且只分配视口中间目标', async () => {
    const baseRef = `sha256:${'b'.repeat(64)}` as const
    const topRef = `sha256:${'c'.repeat(64)}` as const
    const document = createImageEditDocumentV3({ width: 1_024, height: 8 })
    const base = createImageEditRasterLayerV3('base', '底图', baseRef)
    const top = createImageEditRasterLayerV3('top', '前景', topRef)
    top.blendMode = 'screen'
    document.layers = [base, top]
    const compilation = compileImageEditorGpuRasterSceneV3(document, [baseRef, topRef].map((resourceRef) => ({
      resourceRef, byteLength: 1_024 * 8 * 4, mediaType: 'image/png',
    })))
    expect(compilation.supported).toBe(true)
    if (!compilation.supported) return
    expect(compilation.scene.requiresRenderGraph).toBe(true)
    const compositor = new ImageEditorGpuRasterCompositorV3(gpu)
    compositor.syncScene(compilation.scene)
    compositor.updateViewport({
      stageWidth: 1_024, stageHeight: 8, viewportKey: 'large-screen-blend',
      viewport: { documentX: 0, documentY: 0, width: 1_024, height: 8, zoom: 1, devicePixelRatio: 1 },
    })
    const uploaded = new Map<string, ReturnType<typeof compositor.uploadTile>>()
    for (const key of compositor.requiredResourceKeys()) {
      const rgba = key.resourceRef === baseRef ? [64, 96, 128, 255] as const : [128, 48, 192, 255] as const
      const tile = solidLargeTile(key, rgba)
      uploaded.set(imageEditorGpuSceneTileKeyV3(key), compositor.uploadTile(key, tile))
    }
    const pixels = await compositor.readLinearPixelsForTest(
      (key) => uploaded.get(imageEditorGpuSceneTileKeyV3(key)) ?? null,
    )
    const decode = (value: number) => {
      const encoded = value / 255
      return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4
    }
    const expectedRed = decode(64) + decode(128) - decode(64) * decode(128)
    expect(pixels[400 * 4]).toBeCloseTo(expectedRed, 3)
    expect(Math.abs(pixels[511 * 4] - pixels[512 * 4])).toBeLessThanOrEqual(0.001)
    expect(compositor.snapshotStats()).toMatchObject({
      maximumGraphTargetWidth: 1_024,
      maximumGraphTargetHeight: 8,
    })
    expect(compositor.snapshotStats().renderedGraphNodeCount).toBeGreaterThan(0)
    for (const resource of uploaded.values()) resource.destroy()
    compositor.dispose()
  })

  it('合成目标与呈现背板也计入256MiB总预算，超额时在分配前拒绝', async () => {
    const document = createImageEditDocumentV3({ width: 512, height: 512 })
    const compilation = compileImageEditorGpuRasterSceneV3(document, [])
    expect(compilation.supported).toBe(true)
    if (!compilation.supported) return
    const compositor = new ImageEditorGpuRasterCompositorV3(gpu, { memoryBudgetBytes: 1_048_576 })
    compositor.syncScene(compilation.scene)
    compositor.updateViewport({
      stageWidth: 512, stageHeight: 512, viewportKey: 'budget-output',
      viewport: {
        documentX: 0, documentY: 0, width: 512, height: 512,
        zoom: 1, devicePixelRatio: 1,
      },
    })

    await expect(compositor.readLinearPixelsForTest(() => null))
      .rejects.toThrow('合成目标与 atlas 超出会话显存预算')
    compositor.dispose()
  })

  it('复杂图source共用scratch后按实际存活target计预算，不再双计source节点', () => {
    const resourceRef = `sha256:${'7'.repeat(64)}` as const
    const document = createImageEditDocumentV3({ width: 640, height: 640 })
    document.layers = Array.from({ length: 7 }, (_, index) => {
      const layer = createImageEditRasterLayerV3(`budget-layer-${index}`, `预算层${index}`, resourceRef)
      if (index > 0) layer.blendMode = 'screen'
      return layer
    })
    const compilation = compileImageEditorGpuRasterSceneV3(document, [{
      resourceRef, byteLength: 640 * 640 * 4, mediaType: 'image/png',
    }])
    expect(compilation.supported).toBe(true)
    if (!compilation.supported) return
    const budgetBytes = 32 * 1_024 * 1_024
    const compositor = new ImageEditorGpuRasterCompositorV3(gpu, { memoryBudgetBytes: budgetBytes })
    compositor.syncScene(compilation.scene)
    compositor.updateViewport({
      stageWidth: 640, stageHeight: 640, viewportKey: 'graph-source-liveness-budget',
      viewport: { documentX: 0, documentY: 0, width: 640, height: 640, zoom: 1, devicePixelRatio: 1 },
    })
    const sourceNodes = compilation.scene.graph.filter((node) => node.kind === 'source').length
    const semanticTargets = compilation.scene.graph.filter((node) => (
      node.kind !== 'source' && node.kind !== 'alias'
    )).length
    const oldReservation = 640 * 640 * (4 + (sourceNodes + semanticTargets) * 8)
    const liveReservation = 640 * 640 * (4 + (semanticTargets + 1) * 8)

    expect(sourceNodes).toBe(7)
    expect(semanticTargets).toBe(7)
    expect(oldReservation).toBeGreaterThan(budgetBytes)
    expect(liveReservation).toBeLessThan(budgetBytes)
    expect(compositor.memoryPressureBytes()).toBe(0)
    compositor.dispose()
  })
})

function largeStepTile(key: ImageEditorGpuSceneTileKeyV3): ImageEditorV3SourceTile {
  const coreX = key.tileX * 512
  const originX = Math.max(0, coreX - 1)
  const endX = Math.min(8_192, coreX + 513)
  const width = endX - originX
  const height = 8
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      pixels[offset] = originX + x >= 512 ? 255 : 0
      pixels[offset + 3] = 255
    }
  }
  return {
    resourceRef: key.resourceRef, mip: key.mip, tileX: key.tileX, tileY: key.tileY, halo: 1,
    width, height, channels: 4, bitDepth: 8, sampleFormat: 'uint', numericRange: 'unorm8',
    byteOrder: 'little-endian', rowStride: width * 4, colorSpace: 'srgb', transferFunction: 'srgb',
    alphaMode: 'straight', orientationApplied: true, originX, originY: 0, pixels: pixels.buffer,
  }
}

function solidLargeTile(
  key: ImageEditorGpuSceneTileKeyV3,
  rgba: readonly [number, number, number, number],
): ImageEditorV3SourceTile {
  const coreX = key.tileX * 512
  const originX = Math.max(0, coreX - 1)
  const endX = Math.min(1_024, coreX + 513)
  const width = endX - originX
  const height = 8
  const pixels = new Uint8Array(width * height * 4)
  for (let offset = 0; offset < pixels.length; offset += 4) pixels.set(rgba, offset)
  return {
    resourceRef: key.resourceRef, mip: key.mip, tileX: key.tileX, tileY: key.tileY, halo: 1,
    width, height, channels: 4, bitDepth: 8, sampleFormat: 'uint', numericRange: 'unorm8',
    byteOrder: 'little-endian', rowStride: width * 4, colorSpace: 'srgb', transferFunction: 'srgb',
    alphaMode: 'straight', orientationApplied: true, originX, originY: 0, pixels: pixels.buffer,
  }
}

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
