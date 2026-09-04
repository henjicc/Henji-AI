import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { init, type Gpu } from 'vgpu/node'

import {
  IMAGE_EDIT_BLEND_MODES_V3,
  compileImageEditRenderPlanV3,
  convertFloat32TileColorDomainV3,
  createBuiltInImageEditRenderNodeRegistry,
  createFloat32MaskTile,
  createImageEditAdjustmentLayerV3,
  createImageEditDocumentV3,
  createImageEditEffectLayerV3,
  createImageEditGroupLayerV3,
  createImageEditRasterLayerV3,
  createImageEditSparseMaskReferenceV3,
  decodeInterleavedRgbaSourceTileV3,
  executeImageEditCpuRenderPlanV3,
  mapImageEditOutputPixelToSourceV3,
  resampleImageEditMaskAffineV3,
  resampleImageEditRgbaAffineV3,
  resolveImageEditOutputGeometryV3,
  type ImageEditAdjustmentLayerV3,
  type ImageEditDocumentV3,
  type ImageEditJsonObjectV3,
  type ImageEditRenderPlanNode,
} from '@/core/imageEdit/v3'
import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import { createDefaultDiffusionOperationParams } from '@/core/imageEdit/diffusionParams'
import { createDefaultVgpuGlowOperationParams } from '@/core/imageEdit/vgpuGlowParams'
import { compareImageEditorGoldenV3 } from '../testing/imageEditorGpuBaselineV3'
import { ImageEditorGpuRasterCompositorV3 } from './imageEditorGpuRasterCompositorV3'
import { compileImageEditorGpuRasterSceneV3 } from './imageEditorGpuRasterSceneCompilerV3'
import { imageEditorGpuSceneTileKeyV3 } from './imageEditorGpuSceneProtocolV3'

const WIDTH = 32
const HEIGHT = 24
const registry = createBuiltInImageEditRenderNodeRegistry()
let gpu: Gpu

beforeAll(async () => { gpu = await init() })
afterAll(() => gpu.dispose())

describe('GPU RenderGraph 完整图层语义（真实 WebGPU）', () => {
  it.each(IMAGE_EDIT_BLEND_MODES_V3)('%s 混合与CPU真值一致', async (blendMode) => {
    const document = baseDocument(`blend-${blendMode}`)
    const base = raster(1, '底图')
    const top = raster(2, '前景')
    top.opacity = 0.73
    top.blendMode = blendMode
    top.transform = [1, 0, 0, 1, 1, -1]
    document.layers = [base, top]
    assertBlendTolerance(await compareDocument(document, tiles([1, 2])))
  })

  it('嵌套隔离组、组蒙版和子层蒙版与CPU真值一致，重复帧不重算子图', async () => {
    const document = baseDocument('nested-isolated-mask')
    const outer = createImageEditGroupLayerV3('outer', '外组')
    outer.isolated = true
    outer.opacity = 0.81
    outer.mask = { resourceId: ref(90), inverted: false }
    const inner = createImageEditGroupLayerV3('inner', '内组')
    inner.isolated = true
    const subject = raster(3, '主体')
    subject.blendMode = 'screen'
    subject.mask = { resourceId: ref(91), inverted: true }
    const texture = raster(4, '纹理')
    texture.blendMode = 'multiply'
    inner.children = [subject, texture]
    outer.children = [inner]
    document.layers = [raster(1, '底图'), outer]
    const result = await compareDocument(document, tiles([1, 3, 4, 90, 91], new Set([90, 91])))
    assertBlendTolerance(result)
    expect(result.secondStats.renderedGraphNodeCount).toBe(result.firstStats.renderedGraphNodeCount)
    expect(result.secondStats.graphCacheHitCount).toBeGreaterThan(result.firstStats.graphCacheHitCount ?? 0)
  })

  it('sparse r8unorm蒙版沿用CPU的defaultValue、反相和单瓦片语义', async () => {
    const document = baseDocument('sparse-mask')
    const top = raster(7, '稀疏蒙版前景')
    top.opacity = 0.67
    top.blendMode = 'overlay'
    top.mask = {
      ...createImageEditSparseMaskReferenceV3('sparse-mask-7', true, 0),
      tiles: { '0/0/0': ref(93) },
    }
    document.layers = [raster(1, '底图'), top]
    const result = await compareDocument(document, tiles([1, 7, 93], new Set([93])))
    assertBlendTolerance(result)
  })

  it('fast blur在同一RenderGraph Target链内执行且重复帧命中缓存', async () => {
    const document = baseDocument('fast-blur-target')
    document.layers = [
      raster(12, '源'),
      createImageEditEffectLayerV3('fast-blur', '快速模糊', 'image.fast-blur-v3', { radius: 20 }),
    ]
    const result = await compareDocument(document, tiles([12]))
    expect(globalSsim(result.reference, result.candidate)).toBeGreaterThanOrEqual(0.999)
    expect(result.secondStats.graphCacheHitCount).toBeGreaterThan(result.firstStats.graphCacheHitCount ?? 0)
  })

  it.each([
    ['小图/最小值', 16, 12, 0],
    ['小图/默认值', 16, 12, 12],
    ['小图/最大值', 16, 12, 1000],
    ['常规图/最小值', 128, 96, 0],
    ['常规图/默认值', 128, 96, 12],
    ['常规图/最大值', 128, 96, 1000],
  ] as const)('fast blur合法范围%s保持CPU三方框真值', async (_label, width, height, radius) => {
    const document = baseDocument(`fast-blur-range-${width}-${height}-${radius}`, width, height)
    document.layers = [
      raster(120, '源'),
      createImageEditEffectLayerV3(`fast-blur-${radius}`, '快速模糊', 'image.fast-blur-v3', { radius }),
    ]
    const startedAt = performance.now()
    const result = await compareDocument(document, tilesSized([120], width, height))
    const elapsedMs = performance.now() - startedAt
    const ssim = globalSsim(result.reference, result.candidate)
    expect(ssim).toBeGreaterThanOrEqual(0.999)
    expect(elapsedMs).toBeLessThan(30_000)
  }, 35_000)

  it('fast blur经过generic effect mix保留蒙版、opacity和预乘alpha语义', async () => {
    const document = baseDocument('fast-blur-mix')
    const effectLayer = createImageEditEffectLayerV3(
      'fast-blur-mix', '快速模糊混合', 'image.fast-blur-v3', { radius: 5 },
    )
    effectLayer.opacity = 0.64
    effectLayer.mask = { resourceId: ref(94), inverted: false }
    document.layers = [raster(13, '源'), effectLayer]
    const result = await compareDocument(document, tiles([13, 94], new Set([94])))
    expect(globalSsim(result.reference, result.candidate)).toBeGreaterThanOrEqual(0.999)
  })

  it('diffusion复用正式WGSL并在同一RenderGraph Frame保持CPU真值', async () => {
    const document = baseDocument('diffusion-target')
    document.layers = [raster(14, '源'), createImageEditEffectLayerV3(
      'diffusion', '柔光', 'image.diffusion', createDefaultDiffusionOperationParams() as unknown as ImageEditJsonObjectV3,
    )]
    const result = await compareDocument(document, tiles([14]))
    expect(globalSsim(result.reference, result.candidate)).toBeGreaterThanOrEqual(0.999)
  })

  it('vgpu glow复用正式WGSL并在同一RenderGraph Frame保持CPU真值', async () => {
    const document = baseDocument('glow-target')
    document.layers = [raster(15, '源'), createImageEditEffectLayerV3(
      'glow', '辉光', 'image.vgpu-glow',
      createDefaultVgpuGlowOperationParams() as unknown as ImageEditJsonObjectV3,
    )]
    const result = await compareDocument(document, tiles([15]))
    expect(globalSsim(result.reference, result.candidate)).toBeGreaterThanOrEqual(0.999)
  })

  it('三效果共用scratch与金字塔后仍在同一Frame保持CPU真值', async () => {
    const document = baseDocument('shared-effect-targets')
    document.layers = [
      raster(16, '源'),
      createImageEditEffectLayerV3('glow-shared', '辉光', 'image.vgpu-glow',
        createDefaultVgpuGlowOperationParams() as unknown as ImageEditJsonObjectV3),
      createImageEditEffectLayerV3('diffusion-shared', '柔光', 'image.diffusion',
        createDefaultDiffusionOperationParams() as unknown as ImageEditJsonObjectV3),
      createImageEditEffectLayerV3('blur-shared', '模糊', 'image.fast-blur-v3', { radius: 5 }),
    ]
    const result = await compareDocument(document, tiles([16]))
    expect(globalSsim(result.reference, result.candidate)).toBeGreaterThanOrEqual(0.999)
  })

  it('瞬态变换仅失效融合atlas source的合成节点，无关子图继续命中缓存', async () => {
    const document = baseDocument('local-invalidation')
    const top = raster(8, '移动层')
    top.blendMode = 'screen'
    document.layers = [raster(1, '底图'), top]
    const result = await compareDocument(document, tiles([1, 8]), (compositor) => {
      compositor.updateTransientTransform(top.id, [1, 0, 0, 1, 3, 2])
    })
    expect(result.thirdStats).not.toBeNull()
    expect(result.thirdStats!.renderedGraphNodeCount! - result.secondStats.renderedGraphNodeCount!).toBe(1)
    expect(result.thirdStats!.invalidatedGraphNodeCount! - result.secondStats.invalidatedGraphNodeCount!).toBe(1)
    expect(result.thirdStats!.graphCacheHitCount! - result.secondStats.graphCacheHitCount!).toBeGreaterThanOrEqual(1)
    expect(result.thirdCandidate).not.toEqual(result.candidate)
  })

  it('裁剪、90度orientation与镜像的呈现坐标逐像素匹配CPU映射', async () => {
    const document = baseDocument('presentation-geometry')
    document.geometry.orientation = { rotate: 90, mirrored: true }
    document.geometry.crop = { x: 3, y: 4, width: 12, height: 16 }
    document.layers = [raster(9, '方向测试')]
    const resources = tiles([9])
    const descriptor = resources.get(ref(9))!
    const compilation = compileImageEditorGpuRasterSceneV3(document, [{
      resourceRef: descriptor.resourceRef, byteLength: descriptor.pixels.byteLength, mediaType: 'image/png',
    }])
    expect(compilation.supported).toBe(true)
    if (!compilation.supported) throw new Error(compilation.reason)
    const compositor = new ImageEditorGpuRasterCompositorV3(gpu)
    compositor.syncScene(compilation.scene)
    compositor.updateViewport({
      stageWidth: 12, stageHeight: 16, viewportKey: 'geometry-golden',
      viewport: { documentX: 0, documentY: 0, width: 12, height: 16, zoom: 1, devicePixelRatio: 1 },
    })
    const key = compositor.requiredResourceKeys()[0]
    const texture = compositor.uploadTile(key, descriptor)
    const candidate = await compositor.readPresentedPixelsForTest(() => texture)
    const source = new Uint8Array(descriptor.pixels)
    const geometry = resolveImageEditOutputGeometryV3(document.geometry)
    let maxError = 0
    for (let y = 0; y < geometry.outputHeight; y += 1) {
      for (let x = 0; x < geometry.outputWidth; x += 1) {
        const [sourceX, sourceY] = mapImageEditOutputPixelToSourceV3(x, y, geometry)
        const expectedOffset = (sourceY * WIDTH + sourceX) * 4
        const candidateOffset = (y * geometry.outputWidth + x) * 4
        for (let channel = 0; channel < 4; channel += 1) {
          const expected = channel === 3
            ? source[expectedOffset + channel]
            : Math.round(source[expectedOffset + channel] * source[expectedOffset + 3] / 255)
          maxError = Math.max(maxError, Math.abs(candidate[candidateOffset + channel] - expected))
        }
      }
    }
    expect(maxError).toBeLessThanOrEqual(1)
    texture.destroy()
    compositor.dispose()
  })

  it.each([
    ['exposure', { stops: 0.35, offset: 0.015, gamma: 1.08 }],
    ['curves', {
      master: [{ x: 0, y: 0 }, { x: 0.45, y: 0.58 }, { x: 1, y: 1 }],
      red: [{ x: 0, y: 0.02 }, { x: 1, y: 0.96 }],
      green: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      blue: [{ x: 0, y: 0.04 }, { x: 1, y: 1 }],
    }],
    ['temperature-tint', { temperature: 0.28, tint: -0.17, workingSpace: 'srgb' }],
    ['hsl', { hueDegrees: 24, saturation: 0.18, lightness: -0.08 }],
  ] as const)('%s 调整层与CPU真值一致', async (adjustmentId, params) => {
    const document = baseDocument(`adjustment-${adjustmentId}`)
    const adjustment = createImageEditAdjustmentLayerV3(
      `adjustment-${adjustmentId}`, adjustmentId, adjustmentId,
      structuredClone(params) as ImageEditJsonObjectV3,
    )
    adjustment.opacity = 0.86
    adjustment.blendMode = 'soft-light'
    adjustment.mask = { resourceId: ref(92), inverted: false }
    document.layers = [raster(5, '底图'), adjustment]
    assertBlendTolerance(await compareDocument(document, tiles([5, 92], new Set([92]))))
  })

  it('仅安全融合连续无蒙版normal曝光，并保持CPU真值', async () => {
    const document = baseDocument('fused-exposure')
    const first = adjustment('first', { stops: 0.2, offset: 0.01, gamma: 1.02 })
    const second = adjustment('second', { stops: -0.1, offset: -0.005, gamma: 0.98 })
    document.layers = [raster(6, '底图'), first, second]
    const result = await compareDocument(document, tiles([6]))
    assertBlendTolerance(result)
    expect(result.firstStats.fusedAdjustmentCount).toBe(1)
  })
})

function ref(seed: number): `sha256:${string}` {
  return `sha256:${seed.toString(16).padStart(64, '0')}`
}

function baseDocument(id: string, width = WIDTH, height = HEIGHT): ImageEditDocumentV3 {
  return createImageEditDocumentV3({ width, height, documentId: id })
}

function raster(seed: number, name: string): ReturnType<typeof createImageEditRasterLayerV3> {
  return createImageEditRasterLayerV3(`layer-${seed}`, name, ref(seed))
}

function adjustment(id: string, params: Record<string, number>): ImageEditAdjustmentLayerV3 {
  return createImageEditAdjustmentLayerV3(id, id, 'exposure', params)
}

function tiles(seeds: readonly number[], masks = new Set<number>()): Map<string, ImageEditorV3SourceTile> {
  return tilesSized(seeds, WIDTH, HEIGHT, masks)
}

function tilesSized(
  seeds: readonly number[],
  width: number,
  height: number,
  masks = new Set<number>(),
): Map<string, ImageEditorV3SourceTile> {
  return new Map(seeds.map((seed) => {
    const pixels = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4
        if (masks.has(seed)) {
          const value = ((x * 19 + y * 13 + seed) % 256)
          pixels.set([value, value, value, 255], offset)
        } else {
          pixels.set([
            (x * 17 + seed * 29) % 256,
            (y * 23 + seed * 11) % 256,
            (x * 7 + y * 13 + seed * 19) % 256,
            96 + ((x * 5 + y * 3 + seed) % 160),
          ], offset)
        }
      }
    }
    return [ref(seed), {
      resourceRef: ref(seed), mip: 0, tileX: 0, tileY: 0, halo: 0,
      width, height, channels: 4, bitDepth: 8,
      sampleFormat: 'uint', numericRange: 'unorm8', byteOrder: 'little-endian',
      rowStride: width * 4, colorSpace: 'srgb', transferFunction: 'srgb',
      alphaMode: 'straight', orientationApplied: true, originX: 0, originY: 0,
      pixels: pixels.buffer,
    } satisfies ImageEditorV3SourceTile]
  }))
}

async function compareDocument(
  document: ImageEditDocumentV3,
  resources: ReadonlyMap<string, ImageEditorV3SourceTile>,
  mutate?: (compositor: ImageEditorGpuRasterCompositorV3) => void,
) {
  const width = document.geometry.width
  const height = document.geometry.height
  const descriptors = [...resources.values()].map((tile) => ({
    resourceRef: tile.resourceRef, byteLength: tile.pixels.byteLength, mediaType: 'image/png',
  }))
  const compilation = compileImageEditorGpuRasterSceneV3(document, descriptors)
  expect(compilation.supported).toBe(true)
  if (!compilation.supported) throw new Error(compilation.reason)
  const compositor = new ImageEditorGpuRasterCompositorV3(gpu)
  compositor.syncScene(compilation.scene)
  compositor.updateViewport({
    stageWidth: width, stageHeight: height, viewportKey: 'graph-golden',
    viewport: { documentX: 0, documentY: 0, width, height, zoom: 1, devicePixelRatio: 1 },
  })
  const uploaded = new Map<string, ReturnType<typeof compositor.uploadTile>>()
  for (const key of compositor.requiredResourceKeys()) {
    uploaded.set(imageEditorGpuSceneTileKeyV3(key), compositor.uploadTile(key, resources.get(key.resourceRef)!))
  }
  const resolve = (key: Parameters<typeof compositor.uploadTile>[0]) => uploaded.get(imageEditorGpuSceneTileKeyV3(key)) ?? null
  const candidate = await compositor.readLinearPixelsForTest(resolve)
  const firstStats = compositor.snapshotStats()
  await compositor.readLinearPixelsForTest(resolve)
  const secondStats = compositor.snapshotStats()
  mutate?.(compositor)
  const thirdCandidate = mutate ? await compositor.readLinearPixelsForTest(resolve) : null
  const thirdStats = mutate ? compositor.snapshotStats() : null
  const plan = compileImageEditRenderPlanV3(document, registry, 'stable')
  const rect = { x: 0, y: 0, width, height }
  const cpu = await executeImageEditCpuRenderPlanV3(plan, {
    loadRaster: async (node) => decodeInterleavedRgbaSourceTileV3({
      ...resources.get(resourceId(node))!, colorSpace: 'srgb',
    }),
    rasterizeAnnotations: async () => { throw new Error('3.1 golden不含标注') },
    loadMask: async (mask) => {
      const resource = resources.get('resourceId' in mask ? mask.resourceId : Object.values(mask.tiles)[0])!
      const rgba = new Uint8Array(resource.pixels)
      return createFloat32MaskTile(width, height, Float32Array.from({ length: width * height }, (_, pixel) => rgba[pixel * 4] / 255))
    },
    transformContent: async (tile, transform) => resampleImageEditRgbaAffineV3(tile, rect, rect, transform),
    transformMask: async (mask, transform) => resampleImageEditMaskAffineV3(mask, rect, rect, transform),
  })
  if (!cpu) throw new Error('CPU RenderPlan没有输出')
  const reference = convertFloat32TileColorDomainV3(cpu, 'linear-light').data
  const comparison = compareImageEditorGoldenV3(reference, candidate, 0.01)
  for (const texture of uploaded.values()) texture.destroy()
  compositor.dispose()
  return { comparison, reference, candidate, firstStats, secondStats, thirdStats, thirdCandidate }
}

function globalSsim(left: Float32Array, right: Float32Array): number {
  let meanLeft = 0; let meanRight = 0
  for (let index = 0; index < left.length; index += 1) { meanLeft += left[index]; meanRight += right[index] }
  meanLeft /= left.length; meanRight /= right.length
  let varianceLeft = 0; let varianceRight = 0; let covariance = 0
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] - meanLeft; const b = right[index] - meanRight
    varianceLeft += a * a; varianceRight += b * b; covariance += a * b
  }
  const divisor = Math.max(1, left.length - 1)
  varianceLeft /= divisor; varianceRight /= divisor; covariance /= divisor
  const c1 = 0.01 ** 2; const c2 = 0.03 ** 2
  return ((2 * meanLeft * meanRight + c1) * (2 * covariance + c2))
    / ((meanLeft ** 2 + meanRight ** 2 + c1) * (varianceLeft + varianceRight + c2))
}

function assertBlendTolerance(result: Awaited<ReturnType<typeof compareDocument>>): void {
  expect(result.comparison.quantizedWithinOneLsbRatio).toBeGreaterThanOrEqual(0.9999)
  expect(result.comparison.quantizedMaxLsbError).toBeLessThanOrEqual(2)
}

function resourceId(node: ImageEditRenderPlanNode): string {
  const source = node.parameters.source as { resourceId?: unknown }
  if (typeof source.resourceId !== 'string') throw new Error('栅格节点缺少资源')
  return source.resourceId
}
