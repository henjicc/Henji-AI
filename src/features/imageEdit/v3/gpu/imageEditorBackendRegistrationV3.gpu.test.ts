import { afterAll, beforeAll, expect, it } from 'vitest'
import { init, type Gpu } from 'vgpu/node'
import { createImageEditDocumentV3, createImageEditEffectLayerV3, createImageEditAdjustmentLayerV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { createBuiltInImageEditRenderNodeRegistry } from '@/core/imageEdit/v3/builtInRenderNodes'
import { compileImageEditRenderPlanV3 } from '@/core/imageEdit/v3/renderPlanCompiler'
import { executeImageEditCpuRenderPlanV3 } from '@/core/imageEdit/v3/execution/cpuRenderPlanExecutor'
import { decodeInterleavedRgbaSourceTileV3 } from '@/core/imageEdit/v3/execution/sourceTileDecode'
import { convertFloat32TileColorDomainV3 } from '@/core/imageEdit/v3/execution/tileColor'
import type { ImageEditJsonObjectV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import { ImageEditorGpuRasterCompositorV3 } from './imageEditorGpuRasterCompositorV3'
import { compileImageEditorGpuRasterSceneV3 } from './imageEditorGpuRasterSceneCompilerV3'
import { imageEditorGpuSceneTileKeyV3 } from './imageEditorGpuSceneProtocolV3'

let gpu: Gpu
const errors: string[] = []
beforeAll(async () => { gpu = await init(); gpu.onError(error => { errors.push(String(error)) }) })
afterAll(() => gpu?.dispose())

const cases: Array<[string, ImageEditJsonObjectV3]> = [
  ['exposure', { stops: .3, offset: .01, gamma: 1.1 }],
  ['curves', { master: [{ x: 0, y: 0 }, { x: .5, y: .6 }, { x: 1, y: 1 }] }],
  ['temperature-tint', { temperature: .2, tint: -.1 }],
  ['hsl', { hueDegrees: 25, saturation: .1, lightness: -.1 }],
  ['color_grade', { exposure: .2, saturation: 10 }],
  ['gaussian_blur', { sigma_fraction_height: .08, axis: 'both', edge_mode: 'transparent' }],
  ['gaussian_blur', { sigma_fraction_height: .25, axis: 'both', edge_mode: 'transparent' }],
  ['gaussian_blur', { sigma_fraction_height: .0019, axis: 'horizontal', edge_mode: 'clamp' }],
  ['gaussian_blur', { sigma_fraction_height: 0, axis: 'vertical', edge_mode: 'clamp' }],
]

it.each(['stable', 'export'] as const)('%s 正式图片登记的 CPU/GPU 同参数逐像素一致且没有设备验证错误', async quality => {
  const width = 129, height = 131
  const resourceRef = `sha256:${'a'.repeat(64)}` as const
  const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 128 + i % 127 : (i * 17) % 256)
  const source: ImageEditorV3SourceTile = { resourceRef, mip: 0, tileX: 0, tileY: 0, width, height,
    halo: 0, bitDepth: 8, sampleFormat: 'uint', numericRange: 'unorm8', channels: 4, byteOrder: 'little-endian', rowStride: width * 4,
    colorSpace: 'srgb', transferFunction: 'srgb', alphaMode: 'straight', orientationApplied: true,
    originX: 0, originY: 0, pixels: pixels.buffer }
  errors.length = 0
  gpu.gpu.pushErrorScope('validation')
  try {
    for (const [id, params] of cases) {
      const document = createImageEditDocumentV3({ width, height })
      document.layers = [createImageEditRasterLayerV3('source', '源', resourceRef),
        (id === 'gaussian_blur' ? createImageEditEffectLayerV3 : createImageEditAdjustmentLayerV3)('processor', '处理', id, params)]
      const compiled = compileImageEditorGpuRasterSceneV3(document, [{ resourceRef, byteLength: pixels.byteLength, mediaType: 'image/png' }], undefined, quality)
      if (!compiled.supported) throw new Error(compiled.reason)
      const compositor = new ImageEditorGpuRasterCompositorV3(gpu)
      const uploaded = new Map<string, ReturnType<typeof compositor.uploadTile>>()
      try {
        compositor.syncScene(compiled.scene)
        compositor.updateViewport({ stageWidth: width, stageHeight: height, viewportKey: `${id}:${quality}`,
          viewport: { documentX: 0, documentY: 0, width, height, zoom: 1, devicePixelRatio: 1 } })
        for (const key of compositor.requiredResourceKeys()) uploaded.set(imageEditorGpuSceneTileKeyV3(key), compositor.uploadTile(key, source))
        const candidate = await compositor.readLinearPixelsForTest(key => uploaded.get(imageEditorGpuSceneTileKeyV3(key)) ?? null)
        const plan = compileImageEditRenderPlanV3(document, createBuiltInImageEditRenderNodeRegistry(), quality)
        const cpu = await executeImageEditCpuRenderPlanV3(plan, { loadRaster: async () => decodeInterleavedRgbaSourceTileV3({ ...source, colorSpace: 'srgb' }),
          rasterizeAnnotations: async () => { throw new Error('无标注') } })
        if (!cpu) throw new Error('没有 CPU 结果')
        const reference = convertFloat32TileColorDomainV3(cpu, 'linear-light').data
        expect(candidate.some(value => value > .1), id).toBe(true)
        let maximum = 0, squared = 0
        candidate.forEach((value, index) => { const error = Math.abs(value - reference[index]); maximum = Math.max(maximum, error); squared += error * error })
        // 整条预览链含源解码、Gaussian 多工序及图层合成的 fp16 写入；核单测的预算不包含这些写入。
        // final 使用 R13 SDR 标准；interactive 整链额外保留一个 fp16 量化步长的 RMSE 预算。
        expect(maximum, `${id}:${JSON.stringify(params)}`).toBeLessThan(id === 'color_grade' ? 2 / 255 : .002)
        expect(Math.sqrt(squared / candidate.length), id).toBeLessThan(id === 'color_grade' ? 1 / 255 : id === 'gaussian_blur' && quality === 'stable' ? .001 : .0005)
        if (id === 'gaussian_blur' && params.sigma_fraction_height === .25) {
          // 真视口/tile 管线必须保留整幅计划的采样相位，不能把 tile 当作新的文档。
          const region = { x: 43, y: 47, width: 49, height: 53 }
          compositor.updateViewport({ stageWidth: region.width, stageHeight: region.height, viewportKey: `${id}:${quality}:region`,
            viewport: { documentX: region.x, documentY: region.y, width: region.width, height: region.height, zoom: 1, devicePixelRatio: 1 } })
          const window = await compositor.readLinearPixelsForTest(key => uploaded.get(imageEditorGpuSceneTileKeyV3(key)) ?? null)
          for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) for (let channel = 0; channel < 4; channel++) {
            expect(window[(y * region.width + x) * 4 + channel]).toBeCloseTo(candidate[((y + region.y) * width + x + region.x) * 4 + channel], 5)
          }
        }
      } finally { for (const texture of uploaded.values()) texture.destroy(); compositor.dispose() }
    }
  } finally {
    expect(await gpu.gpu.popErrorScope()).toBeNull()
    expect(errors).toEqual([])
  }
}, 30000)
