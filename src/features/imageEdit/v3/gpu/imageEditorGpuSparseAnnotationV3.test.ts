import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { init, type Gpu } from 'vgpu/node'

import {
  compileImageEditRenderPlanV3,
  convertFloat32TileColorDomainV3,
  createBuiltInImageEditRenderNodeRegistry,
  createImageEditAnnotationLayerV3,
  createImageEditDocumentV3,
  createImageEditEffectLayerV3,
  createImageEditRasterLayerV3,
  createImageEditSparseMaskReferenceV3,
  decodeInterleavedRgbaSourceTileV3,
  executeImageEditCpuRenderPlanV3,
} from '@/core/imageEdit/v3'
import { ANNOTATION_DEFAULT_STROKE_HEX, WHITE_HEX } from '@/core/theme/colorTokens'
import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import { ImageEditorGpuRasterCompositorV3 } from './imageEditorGpuRasterCompositorV3'
import { compileImageEditorGpuRasterSceneV3 } from './imageEditorGpuRasterSceneCompilerV3'
import {
  imageEditorGpuSceneTileKeyV3,
  type ImageEditorGpuSceneTileKeyV3,
} from './imageEditorGpuSceneProtocolV3'

const registry = createBuiltInImageEditRenderNodeRegistry()
let gpu: Gpu

beforeAll(async () => { gpu = await init() })
afterAll(() => gpu.dispose())

describe('GPU 稀疏资源、标注缓存与 halo（真实 WebGPU）', () => {
  it('标注光栅纹理在重复帧命中GPU子图缓存', async () => {
    const width = 32; const height = 24
    const document = createImageEditDocumentV3({ width, height, documentId: 'annotation-cache' })
    const annotation = createImageEditAnnotationLayerV3('annotation', '标注')
    annotation.annotations = [{ id: 'rect', type: 'rect', x: 4, y: 4, width: 12, height: 8,
      stroke: WHITE_HEX, lineWidth: 2 }]
    document.layers = [annotation]
    const compilation = compileImageEditorGpuRasterSceneV3(document, [])
    expect(compilation.supported).toBe(true)
    if (!compilation.supported) throw new Error(compilation.reason)
    const compositor = new ImageEditorGpuRasterCompositorV3(gpu)
    compositor.syncScene(compilation.scene)
    compositor.updateViewport({ stageWidth: width, stageHeight: height,
      viewportKey: 'annotation-cache', viewport: { documentX: 0, documentY: 0,
        width, height, zoom: 1, devicePixelRatio: 1 } })
    const key = compositor.requiredResourceKeys()[0]
    const values = new Float32Array(width * height * 4)
    for (let offset = 0; offset < values.length; offset += 4) values.set([1, 0.5, 0, 0.5], offset)
    const texture = compositor.uploadTile(key, {
      resourceRef: key.resourceRef, mip: key.mip, tileX: key.tileX, tileY: key.tileY,
      halo: 0, width, height, channels: 4, bitDepth: 32,
      sampleFormat: 'float', numericRange: 'scene-linear', byteOrder: 'little-endian',
      rowStride: width * 16, colorSpace: 'scrgb', transferFunction: 'linear',
      alphaMode: 'straight', orientationApplied: true, originX: 0, originY: 0,
      pixels: values.buffer,
    })
    const pixels = await compositor.readLinearPixelsForTest(() => texture)
    const first = compositor.snapshotStats()
    await compositor.readLinearPixelsForTest(() => texture)
    const second = compositor.snapshotStats()
    expect(first.uploadCount).toBe(1)
    expect(Math.max(...pixels.filter((_, index) => index % 4 === 3))).toBeGreaterThan(0.45)
    expect(second).toMatchObject({ uploadCount: 1, pipelineCompileCount: first.pipelineCompileCount })
    texture.destroy()
    compositor.dispose()
  })

  it('标注位于效果下方时仍进入最终输出，显隐只失效相关子图', async () => {
    const width = 32; const height = 24; const baseRef = ref(121)
    const document = createImageEditDocumentV3({ width, height, documentId: 'annotation-visible' })
    const annotation = createImageEditAnnotationLayerV3('annotation-visible', '标注图层')
    annotation.annotations = [{ id: 'rect', type: 'rect', x: 4, y: 4, width: 12, height: 8,
      stroke: WHITE_HEX, lineWidth: 2 }]
    document.layers = [
      createImageEditRasterLayerV3('annotation-base', '底图', baseRef),
      annotation,
      createImageEditEffectLayerV3('annotation-blur', '模糊', 'image.fast-blur-v3', { radius: 1 }),
    ]
    const descriptor = { resourceRef: baseRef, byteLength: width * height * 4, mediaType: 'image/png' }
    const compositor = new ImageEditorGpuRasterCompositorV3(gpu)
    const render = async (): Promise<Float32Array> => {
      const compilation = compileImageEditorGpuRasterSceneV3(document, [descriptor])
      expect(compilation.supported).toBe(true)
      if (!compilation.supported) throw new Error(compilation.reason)
      compositor.syncScene(compilation.scene)
      compositor.updateViewport({ stageWidth: width, stageHeight: height,
        viewportKey: `annotation-visible-${document.revision}`, viewport: {
          documentX: 0, documentY: 0, width, height, zoom: 1, devicePixelRatio: 1,
        } })
      const resources = new Map<string, ReturnType<typeof compositor.uploadTile>>()
      for (const key of compositor.requiredResourceKeys()) {
        const tile = key.resourceKind === 'generated-annotation'
          ? floatSourceTile(key, [1, 0, 0, 1], width, height)
          : constantSourceTile(key, [32, 48, 64, 255], width, height)
        resources.set(imageEditorGpuSceneTileKeyV3(key), compositor.uploadTile(key, tile))
      }
      const pixels = await compositor.readLinearPixelsForTest((key) => (
        resources.get(imageEditorGpuSceneTileKeyV3(key)) ?? null
      ))
      for (const texture of resources.values()) texture.destroy()
      return pixels
    }
    const visible = await render()
    annotation.visible = false; document.revision += 1
    const hidden = await render()
    expect(visible.reduce((sum, value, index) => sum + Math.abs(value - hidden[index]), 0))
      .toBeGreaterThan(1)
    compositor.dispose()
  })

  it('多瓦片稀疏标注在效果链中保留非透明像素', async () => {
    const width = 1024; const height = 8; const baseRef = ref(122)
    const document = createImageEditDocumentV3({ width, height, documentId: 'annotation-sparse' })
    const annotation = createImageEditAnnotationLayerV3('annotation-sparse', '标注图层')
    annotation.annotations = [{ id: 'line', type: 'arrow', points: [508, 2, 516, 6],
      stroke: ANNOTATION_DEFAULT_STROKE_HEX, lineWidth: 2 }]
    document.layers = [
      createImageEditRasterLayerV3('annotation-sparse-base', '底图', baseRef),
      annotation,
      createImageEditEffectLayerV3('annotation-sparse-blur', '模糊', 'image.fast-blur-v3', { radius: 1 }),
    ]
    const compositor = new ImageEditorGpuRasterCompositorV3(gpu)
    const render = async (): Promise<Float32Array> => {
      const compilation = compileImageEditorGpuRasterSceneV3(document, [{
        resourceRef: baseRef, byteLength: width * height * 4, mediaType: 'image/png',
      }])
      expect(compilation.supported).toBe(true)
      if (!compilation.supported) throw new Error(compilation.reason)
      compositor.syncScene(compilation.scene)
      compositor.updateViewport({ stageWidth: width, stageHeight: height,
        viewportKey: `annotation-sparse-${document.revision}`, viewport: {
          documentX: 0, documentY: 0, width, height, zoom: 1, devicePixelRatio: 1,
        } })
      const resources = new Map<string, ReturnType<typeof compositor.uploadTile>>()
      for (const key of compositor.requiredResourceKeys()) {
        const tileWidth = 512
        const tile = key.resourceKind === 'generated-annotation'
          ? sparseFloatSourceTile(key, tileWidth, height)
          : constantSourceTile(key, [32, 48, 64, 255], tileWidth, height)
        resources.set(imageEditorGpuSceneTileKeyV3(key), compositor.uploadTile(key, tile))
      }
      const pixels = await compositor.readLinearPixelsForTest((key) => (
        resources.get(imageEditorGpuSceneTileKeyV3(key)) ?? null
      ))
      for (const texture of resources.values()) texture.destroy()
      return pixels
    }
    const visible = await render()
    annotation.visible = false; document.revision += 1
    const hidden = await render()
    expect(visible.reduce((sum, value, index) => sum + Math.abs(value - hidden[index]), 0))
      .toBeGreaterThan(0.1)
    compositor.dispose()
  })

  it('跨512边界的双tile sparse mask经viewport assembly无接缝', async () => {
    const document = createImageEditDocumentV3({ width: 1024, height: 8 })
    const baseRef = ref(101); const topRef = ref(102); const maskLeft = ref(103); const maskRight = ref(104)
    const base = createImageEditRasterLayerV3('seam-base', '底图', baseRef)
    const top = createImageEditRasterLayerV3('seam-top', '前景', topRef)
    top.mask = { ...createImageEditSparseMaskReferenceV3('seam-mask', false, 0),
      tiles: { '0/0/0': maskLeft, '0/1/0': maskRight } }
    document.layers = [base, top]
    const compilation = compileImageEditorGpuRasterSceneV3(document,
      [baseRef, topRef, maskLeft, maskRight].map((resourceRef) => ({
        resourceRef, byteLength: 512 * 8 * 4, mediaType: 'image/png',
      })))
    expect(compilation.supported).toBe(true)
    if (!compilation.supported) throw new Error(compilation.reason)
    const compositor = new ImageEditorGpuRasterCompositorV3(gpu)
    compositor.syncScene(compilation.scene)
    compositor.updateViewport({ stageWidth: 8, stageHeight: 8, viewportKey: 'mask-seam',
      viewport: { documentX: 508, documentY: 0, width: 8, height: 8, zoom: 1, devicePixelRatio: 1 } })
    const uploaded = new Map<string, ReturnType<typeof compositor.uploadTile>>()
    for (const key of compositor.requiredResourceKeys()) {
      const color: readonly [number, number, number, number] = key.resourceRef === topRef
        ? [255, 0, 0, 255]
        : key.resourceRef === maskRight ? [255, 255, 255, 255] : [0, 0, 0, 255]
      uploaded.set(imageEditorGpuSceneTileKeyV3(key), compositor.uploadTile(key,
        constantSourceTile(key, color, 512, 8)))
    }
    const pixels = await compositor.readLinearPixelsForTest((key) => (
      uploaded.get(imageEditorGpuSceneTileKeyV3(key)) ?? null
    ))
    for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) {
      const offset = (y * 8 + x) * 4
      expect([...pixels.slice(offset, offset + 4)]).toEqual(x < 4 ? [0, 0, 0, 1] : [1, 0, 0, 1])
    }
    for (const texture of uploaded.values()) texture.destroy()
    compositor.dispose()
  })

  it('fast blur overscan裁回相邻视口时透明边缘与halo边界无接缝', async () => {
    const width = 96; const height = 32; const viewportWidth = 24
    const resourceRef = ref(110)
    const document = createImageEditDocumentV3({ width, height, documentId: 'fast-blur-halo' })
    document.layers = [
      createImageEditRasterLayerV3('halo-source', '透明边缘源', resourceRef),
      createImageEditEffectLayerV3('halo-blur', '快速模糊', 'image.fast-blur-v3', { radius: 8 }),
    ]
    const pixels = new Uint8Array(width * height * 4)
    for (let y = 6; y < 26; y += 1) for (let x = 36; x < 60; x += 1) {
      const offset = (y * width + x) * 4
      const alpha = Math.min(255, 32 + Math.min(x - 36, 59 - x, y - 6, 25 - y) * 32)
      pixels.set([255, 48, 0, alpha], offset)
    }
    const source: ImageEditorV3SourceTile = {
      resourceRef, mip: 0, tileX: 0, tileY: 0, halo: 0, width, height,
      channels: 4, bitDepth: 8, sampleFormat: 'uint', numericRange: 'unorm8',
      byteOrder: 'little-endian', rowStride: width * 4, colorSpace: 'srgb',
      transferFunction: 'srgb', alphaMode: 'straight', orientationApplied: true,
      originX: 0, originY: 0, pixels: pixels.buffer,
    }
    const compilation = compileImageEditorGpuRasterSceneV3(document, [{
      resourceRef, byteLength: pixels.byteLength, mediaType: 'image/png',
    }])
    expect(compilation.supported).toBe(true)
    if (!compilation.supported) throw new Error(compilation.reason)
    const compositor = new ImageEditorGpuRasterCompositorV3(gpu)
    compositor.syncScene(compilation.scene)
    const renderAt = async (documentX: number): Promise<Float32Array> => {
      compositor.updateViewport({ stageWidth: viewportWidth, stageHeight: height,
        viewportKey: `halo-${documentX}`, viewport: { documentX, documentY: 0,
          width: viewportWidth, height, zoom: 1, devicePixelRatio: 1 } })
      const key = compositor.requiredResourceKeys()[0]
      const texture = compositor.uploadTile(key, source)
      const result = await compositor.readLinearPixelsForTest(() => texture)
      texture.destroy()
      return result
    }
    const left = await renderAt(24)
    const right = await renderAt(48)
    const plan = compileImageEditRenderPlanV3(document, registry, 'stable')
    const cpu = await executeImageEditCpuRenderPlanV3(plan, {
      loadRaster: async () => decodeInterleavedRgbaSourceTileV3({ ...source, colorSpace: 'srgb' }),
      rasterizeAnnotations: async () => { throw new Error('halo golden不含标注') },
      loadMask: async () => { throw new Error('halo golden不含蒙版') },
    })
    if (!cpu) throw new Error('halo golden CPU无输出')
    const reference = convertFloat32TileColorDomainV3(cpu, 'linear-light').data
    const leftReference = cropLinear(reference, width, 24, 0, viewportWidth, height)
    const rightReference = cropLinear(reference, width, 48, 0, viewportWidth, height)
    expect(globalSsim(leftReference, left)).toBeGreaterThanOrEqual(0.999)
    expect(globalSsim(rightReference, right)).toBeGreaterThanOrEqual(0.999)
    for (const output of [left, right]) for (let offset = 0; offset < output.length; offset += 4) {
      expect(output[offset]).toBeLessThanOrEqual(output[offset + 3] + 0.001)
      expect(output[offset + 1]).toBeLessThanOrEqual(output[offset + 3] + 0.001)
      expect(output[offset + 2]).toBeLessThanOrEqual(output[offset + 3] + 0.001)
    }
    compositor.dispose()
  })
})

function ref(seed: number): `sha256:${string}` {
  return `sha256:${seed.toString(16).padStart(64, '0')}`
}

function constantSourceTile(
  key: ImageEditorGpuSceneTileKeyV3,
  color: readonly [number, number, number, number],
  width: number,
  height: number,
): ImageEditorV3SourceTile {
  const pixels = new Uint8Array(width * height * 4)
  for (let offset = 0; offset < pixels.length; offset += 4) pixels.set(color, offset)
  return {
    resourceRef: key.resourceRef, mip: key.mip, tileX: key.tileX, tileY: key.tileY,
    halo: 0, width, height, channels: 4, bitDepth: 8, sampleFormat: 'uint',
    numericRange: 'unorm8', byteOrder: 'little-endian', rowStride: width * 4,
    colorSpace: 'srgb', transferFunction: 'srgb', alphaMode: 'straight',
    orientationApplied: true, originX: key.tileX * 512, originY: key.tileY * 512,
    pixels: pixels.buffer,
  }
}

function floatSourceTile(
  key: ImageEditorGpuSceneTileKeyV3,
  color: readonly [number, number, number, number],
  width: number,
  height: number,
): ImageEditorV3SourceTile {
  const pixels = new Float32Array(width * height * 4)
  for (let offset = 0; offset < pixels.length; offset += 4) pixels.set(color, offset)
  return {
    resourceRef: key.resourceRef, mip: key.mip, tileX: key.tileX, tileY: key.tileY,
    halo: 0, width, height, channels: 4, bitDepth: 32, sampleFormat: 'float',
    numericRange: 'scene-linear', byteOrder: 'little-endian', rowStride: width * 16,
    colorSpace: 'scrgb', transferFunction: 'linear', alphaMode: 'straight',
    orientationApplied: true, originX: key.tileX * 512, originY: key.tileY * 512,
    pixels: pixels.buffer,
  }
}

function sparseFloatSourceTile(
  key: ImageEditorGpuSceneTileKeyV3,
  width: number,
  height: number,
): ImageEditorV3SourceTile {
  const pixels = new Float32Array(width * height * 4)
  const start = key.tileX === 0 ? width - 4 : 0
  const end = key.tileX === 0 ? width : 4
  for (let y = 2; y < 6; y += 1) for (let x = start; x < end; x += 1) {
    pixels.set([1, 0, 0, 1], (y * width + x) * 4)
  }
  return {
    resourceRef: key.resourceRef, mip: key.mip, tileX: key.tileX, tileY: key.tileY,
    halo: 0, width, height, channels: 4, bitDepth: 32, sampleFormat: 'float',
    numericRange: 'scene-linear', byteOrder: 'little-endian', rowStride: width * 16,
    colorSpace: 'scrgb', transferFunction: 'linear', alphaMode: 'straight',
    orientationApplied: true, originX: key.tileX * 512, originY: key.tileY * 512,
    pixels: pixels.buffer,
  }
}

function cropLinear(source: Float32Array, sourceWidth: number, x: number, y: number,
  width: number, height: number): Float32Array {
  const output = new Float32Array(width * height * 4)
  for (let row = 0; row < height; row += 1) {
    output.set(source.subarray(((y + row) * sourceWidth + x) * 4,
      ((y + row) * sourceWidth + x + width) * 4), row * width * 4)
  }
  return output
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
