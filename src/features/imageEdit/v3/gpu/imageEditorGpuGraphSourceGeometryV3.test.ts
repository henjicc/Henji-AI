import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { init, type Gpu } from 'vgpu/node'
import {
  compileImageEditRenderPlanV3, convertFloat32TileColorDomainV3,
  createBuiltInImageEditRenderNodeRegistry, createFloat32MaskTile,
  createImageEditDocumentV3, createImageEditEffectLayerV3, createImageEditGroupLayerV3,
  createImageEditRasterLayerV3, decodeInterleavedRgbaSourceTileV3,
  executeImageEditCpuRenderPlanV3, mapImageEditOutputPixelToSourceV3,
  resampleImageEditMaskAffineV3, resampleImageEditRgbaAffineV3,
  resolveImageEditOutputGeometryV3,
  type ImageEditDocumentV3, type ImageEditTransformV3,
} from '@/core/imageEdit/v3'
import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import { compareImageEditorGoldenV3 } from '../testing/imageEditorGpuBaselineV3'
import { ImageEditorGpuRasterCompositorV3 } from './imageEditorGpuRasterCompositorV3'
import { compileImageEditorGpuRasterSceneV3 } from './imageEditorGpuRasterSceneCompilerV3'
import { imageEditorGpuSceneTileKeyV3 } from './imageEditorGpuSceneProtocolV3'
import { createImageEditorGpuPyramidDescriptorV3 } from './imageEditorGpuTilePlannerV3'

type Color = readonly [number, number, number, number]
interface Source { ref: `sha256:${string}`; width: number; height: number; sample: (x: number, y: number) => Color }
const WHITE: Color = [255, 255, 255, 255]
const CLEAR: Color = [0, 0, 0, 0]
let gpu: Gpu
beforeAll(async () => { gpu = await init() })
afterAll(() => gpu?.dispose())

describe('GPU RenderGraph 源坐标只投影一次（真实 WebGPU）', () => {
  it.each([0, 12])('640源缩至64后模糊%s与真实CPU参考一致，不先截成6×6', async (radius) => {
    const input = source(1, 640, 640)
    const doc = document(input, [.1, 0, 0, .1, 0, 0], radius)
    const session = open(doc, [input])
    try {
      const actual = await session.read()
      assertPixels(actual, await cpuReference(doc, [input], session.layout))
      expect(actual[(32 * 64 + 32) * 4 + 3]).toBe(1)
      expect(actual.filter((_value, index) => index % 4 === 3 && actual[index] > .99)).toHaveLength(4096)
      assertBounded(session.compositor, 64, 64)
    } finally { session.dispose() }
  })

  it('透明源边缘的模糊保留正确范围与Alpha，不放大scratch为源尺寸', async () => {
    const input = source(2, 512, 512, (x, y) => x >= 128 && x < 384 && y >= 128 && y < 384 ? WHITE : CLEAR)
    const doc = document(input, [.125, 0, 0, .125, 0, 0], 12)
    const session = open(doc, [input])
    try {
      const actual = await session.read()
      const reference = await cpuReference(doc, [input], session.layout)
      // 三次方框卷积的rgba16float舍入沿用效果管线精度，以逐通道1LSB约束边缘。
      expect(compareImageEditorGoldenV3(reference, actual).quantizedMaxLsbError).toBeLessThanOrEqual(1)
      expect(actual[(32 * 64 + 32) * 4 + 3]).toBeGreaterThan(actual[3])
      expect(actual[3]).toBeLessThan(.1)
      assertBounded(session.compositor, 64, 64)
    } finally { session.dispose() }
  })

  it('同一资源的两个不同变换图层不会串用source scratch', async () => {
    const input = source(3, 512, 512)
    const doc = document(input, [.0625, 0, 0, .0625, 0, 0], 0)
    const second = createImageEditRasterLayerV3('second', '同源另一图层', input.ref)
    second.transform = [.0625, 0, 0, .0625, 32, 32]
    second.opacity = .5
    doc.layers.splice(1, 0, second)
    const session = open(doc, [input])
    try {
      assertPixels(await session.read(), await cpuReference(doc, [input], session.layout))
      assertPixels(await session.read(), await cpuReference(doc, [input], session.layout))
    } finally { session.dispose() }
  })

  it('文档旋转、裁剪与非零相机起点使用同一次source→document→viewport映射', async () => {
    const input = source(4, 512, 384, (x, y) => y < 64 || y >= 320 ? CLEAR : x < 256 ? [255, 0, 0, 255] : [0, 255, 0, 255])
    const doc = document(input, [.125, 0, 0, .125, 0, 0], 0)
    doc.geometry.height = 48
    doc.geometry.orientation = { rotate: 90, mirrored: true }
    doc.geometry.crop = { x: 4, y: 8, width: 32, height: 40 }
    const layout = viewport(20, 16, 3, 5)
    const session = open(doc, [input], layout)
    try {
      assertPixels(await session.read(), await cpuReference(doc, [input], layout))
      assertBounded(session.compositor, 20, 16)
    } finally { session.dispose() }
  })

  it('隔离组与已投影的蒙版保持CPU语义，opacity不重复执行', async () => {
    const input = source(5, 512, 512)
    const mask = source(6, 64, 64, (x) => x < 32 ? WHITE : [0, 0, 0, 255])
    const doc = document(input, [.125, 0, 0, .125, 0, 0], 0)
    const group = createImageEditGroupLayerV3('group', '隔离蒙版组')
    group.isolated = true
    group.opacity = .5
    group.mask = { resourceId: mask.ref, inverted: false }
    doc.layers[0].opacity = .75
    group.children = [doc.layers[0]]
    doc.layers[0] = group
    const session = open(doc, [input, mask])
    try { assertPixels(await session.read(), await cpuReference(doc, [input, mask], session.layout)) }
    finally { session.dispose() }
  })

  it('瞬态变换、权威提交与重开重建的像素一致，旧source缓存不会回灌', async () => {
    const input = source(7, 512, 512)
    const doc = document(input, [.125, 0, 0, .125, 0, 0], 0)
    const session = open(doc, [input])
    try {
      await session.read()
      // 仅平移：mip和上传纹理不变，必须由有效变换使source scratch失效。
      const transform: ImageEditTransformV3 = [.125, 0, 0, .125, 16, 8]
      session.compositor.updateTransientTransform('source', transform)
      const changed = structuredClone(doc)
      changed.layers[0].transform = transform
      changed.revision += 1
      const reference = await cpuReference(changed, [input], session.layout)
      assertPixels(await session.read(), reference)
      session.compositor.syncScene(compile(changed, [input]))
      assertPixels(await session.read(), reference)
      const reopened = open(changed, [input])
      try { assertPixels(await reopened.read(), reference) }
      finally { reopened.dispose() }
      assertBounded(session.compositor, 64, 64)
    } finally { session.dispose() }
  })
})

function source(seed: number, width: number, height: number, sample: Source['sample'] = () => WHITE): Source {
  return { ref: `sha256:${seed.toString(16).padStart(64, '0')}`, width, height, sample }
}

function document(input: Source, transform: ImageEditTransformV3, radius: number): ImageEditDocumentV3 {
  const doc = createImageEditDocumentV3({ width: 64, height: 64, documentId: `graph-source-${input.ref.slice(-4)}` })
  const layer = createImageEditRasterLayerV3('source', '真实异尺寸源', input.ref)
  layer.transform = transform
  doc.layers = [layer, createImageEditEffectLayerV3('blur', '模糊', 'image.fast-blur-v3', { radius })]
  return doc
}

function compile(doc: ImageEditDocumentV3, inputs: readonly Source[]) {
  const result = compileImageEditorGpuRasterSceneV3(doc,
    inputs.map((input) => ({ resourceRef: input.ref, mediaType: 'image/png', byteLength: input.width * input.height * 4 })),
    Object.fromEntries(inputs.map((input) => [input.ref, createImageEditorGpuPyramidDescriptorV3(input.width, input.height)])))
  if (!result.supported) throw new Error(result.reason)
  expect(result.scene.requiresRenderGraph).toBe(true)
  return result.scene
}

function viewport(width: number, height: number, documentX = 0, documentY = 0): ImageEditorViewportLayoutV3 {
  return { stageWidth: width, stageHeight: height, viewportKey: `geometry-${documentX}-${documentY}`,
    viewport: { documentX, documentY, width, height, zoom: 1, devicePixelRatio: 1 } }
}

function open(doc: ImageEditDocumentV3, inputs: readonly Source[], layout = viewport(64, 64)) {
  const compositor = new ImageEditorGpuRasterCompositorV3(gpu)
  compositor.syncScene(compile(doc, inputs))
  compositor.updateViewport(layout)
  const uploaded = new Map<string, ReturnType<typeof compositor.uploadTile>>()
  return { compositor, layout,
    read: async () => {
      for (const key of compositor.requiredResourceKeys()) {
        if (uploaded.has(imageEditorGpuSceneTileKeyV3(key))) continue
        const input = inputs.find((entry) => entry.ref === key.resourceRef)!
        uploaded.set(imageEditorGpuSceneTileKeyV3(key), compositor.uploadTile(key, tile(input, key.mip, key.tileX, key.tileY)))
      }
      return compositor.readLinearPixelsForTest((key) => uploaded.get(imageEditorGpuSceneTileKeyV3(key)) ?? null)
    },
    dispose: () => { for (const resource of uploaded.values()) resource.destroy(); compositor.dispose() },
  }
}

function tile(input: Source, mip = 0, tileX = 0, tileY = 0, full = false): ImageEditorV3SourceTile {
  const scale = 2 ** mip
  const originX = tileX * 512
  const originY = tileY * 512
  const width = Math.min(full ? input.width : 512, Math.ceil(input.width / scale) - originX)
  const height = Math.min(full ? input.height : 512, Math.ceil(input.height / scale) - originY)
  const pixels = new Uint8Array(width * height * 4)
  // 本组源只含常量或与mip网格对齐的矩形；取单元中心与真实box mip完全相同。
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    pixels.set(input.sample((originX + x + .5) * scale, (originY + y + .5) * scale), (y * width + x) * 4)
  }
  return { resourceRef: input.ref, mip, tileX, tileY, originX, originY, halo: 0,
    width, height, channels: 4, bitDepth: 8, sampleFormat: 'uint', numericRange: 'unorm8',
    byteOrder: 'little-endian', rowStride: width * 4, colorSpace: 'srgb', transferFunction: 'srgb',
    alphaMode: 'straight', orientationApplied: true, pixels: pixels.buffer }
}

async function cpuReference(doc: ImageEditDocumentV3, inputs: readonly Source[], layout: ImageEditorViewportLayoutV3): Promise<Float32Array> {
  const plan = compileImageEditRenderPlanV3(doc, createBuiltInImageEditRenderNodeRegistry(), 'stable')
  const rect = { x: 0, y: 0, width: doc.geometry.width, height: doc.geometry.height }
  const cpu = await executeImageEditCpuRenderPlanV3(plan, {
    loadRaster: async (node) => {
      const resource = node.parameters.source as { resourceId: string }
      return decodeInterleavedRgbaSourceTileV3({
        ...tile(inputs.find((entry) => entry.ref === resource.resourceId)!, 0, 0, 0, true), colorSpace: 'srgb',
      })
    },
    loadMask: async (mask) => {
      if (!('resourceId' in mask)) throw new Error('本组仅测试完整组蒙版')
      const input = inputs.find((entry) => entry.ref === mask.resourceId)!
      const rgba = new Uint8Array(tile(input, 0, 0, 0, true).pixels)
      return createFloat32MaskTile(input.width, input.height, Float32Array.from({ length: input.width * input.height }, (_, index) => rgba[index * 4] / 255))
    },
    rasterizeAnnotations: async () => { throw new Error('本组不含标注') },
    transformContent: async (input, transform) => resampleImageEditRgbaAffineV3(input, { x: 0, y: 0, width: input.width, height: input.height }, rect, transform),
    transformMask: async (input, transform) => resampleImageEditMaskAffineV3(input, { x: 0, y: 0, width: input.width, height: input.height }, rect, transform),
  })
  if (!cpu) throw new Error('CPU参考无输出')
  const linear = convertFloat32TileColorDomainV3(cpu, 'linear-light').data
  const geometry = resolveImageEditOutputGeometryV3(doc.geometry)
  const { width, height, documentX, documentY } = layout.viewport
  const output = new Float32Array(width * height * 4)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const [sourceX, sourceY] = mapImageEditOutputPixelToSourceV3(x + documentX, y + documentY, geometry)
    output.set(linear.subarray((sourceY * cpu.width + sourceX) * 4, (sourceY * cpu.width + sourceX) * 4 + 4), (y * width + x) * 4)
  }
  return output
}

function assertPixels(actual: Float32Array, expected: Float32Array): void {
  expect(actual.length).toBe(expected.length)
  let maximum = 0
  for (let index = 0; index < actual.length; index += 1) maximum = Math.max(maximum, Math.abs(actual[index] - expected[index]))
  expect(maximum).toBeLessThanOrEqual(.001)
}

function assertBounded(compositor: ImageEditorGpuRasterCompositorV3, width: number, height: number): void {
  const stats = compositor.snapshotStats()
  expect(stats.maximumGraphTargetWidth).toBeLessThanOrEqual(width)
  expect(stats.maximumGraphTargetHeight).toBeLessThanOrEqual(height)
}
